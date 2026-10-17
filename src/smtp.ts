/**
 * Cliente SMTP contra Proton Mail Bridge + helpers de threading.
 *
 * Dos piezas:
 *  1. `SmtpClient`: wrapper fino sobre `nodemailer` con pool persistente
 *     (maxConnections 2, maxMessages 50). Bridge habla SMTP con STARTTLS en
 *     1025 contra `127.0.0.1`. Cert autofirmado igual que IMAP.
 *  2. `buildReplyOptions` / `buildForwardOptions`: construyen un
 *     `SendOptions` respetando el estándar RFC 5322 de threading
 *     (`In-Reply-To` + `References`). Sin esto los clientes de correo
 *     tratarían la respuesta como hilo nuevo y romperían la conversación.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import { addrMatches, extractEmail } from './addresses.js'
import type { IImapClient } from './clients/interfaces.js'
import type { ResolvedBridgeConfig } from './config.js'
import { SMTP_POOL_MAX_CONNECTIONS, SMTP_POOL_MAX_MESSAGES } from './constants.js'
import type { EmailFull } from './imap.js'
import { buildTlsOptions } from './tls.js'

// Re-export para consumidores históricos (tests/smtp-helpers.test.ts) que los
// importaban desde aquí antes de consolidarlos en addresses.ts.
export { addrMatches, extractEmail } from './addresses.js'

export interface SendOptions {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  html?: string
  replyTo?: string
  inReplyTo?: string
  references?: string[]
  attachments?: {
    filename: string
    contentBase64: string
    contentType?: string
  }[]
}

export interface SendResult {
  messageId: string
  accepted: string[]
  rejected: string[]
  response: string
}

export class SmtpClient {
  private transporter: Transporter | null = null

  constructor(
    private readonly cfg: ResolvedBridgeConfig,
    private readonly log: {
      info: (m: string, e?: unknown) => void
      debug: (m: string, e?: unknown) => void
      // Hace falta para avisar de que no se valida el certificado (F34).
      warn: (m: string, e?: unknown) => void
    },
  ) {}

  private async ensureConnected(): Promise<Transporter> {
    if (this.transporter) return this.transporter
    const resolvedPass = await this.cfg.passwordResolver()
    const security = this.cfg.smtpSecurity
    this.transporter = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.smtpPort,
      secure: security === 'implicit',
      requireTLS: security === 'starttls',
      // Mismas opciones que IMAP: CA si está configurada, aviso si no se valida.
      tls: buildTlsOptions(this.cfg, this.log),
      auth: { user: this.cfg.user, pass: resolvedPass },
      pool: true,
      maxConnections: SMTP_POOL_MAX_CONNECTIONS,
      maxMessages: SMTP_POOL_MAX_MESSAGES,
    })
    return this.transporter
  }

  async send(opts: SendOptions): Promise<SendResult> {
    const transporter = await this.ensureConnected()
    const info = await transporter.sendMail({
      from: this.cfg.from,
      to: opts.to.join(', '),
      cc: opts.cc?.join(', '),
      bcc: opts.bcc?.join(', '),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      replyTo: opts.replyTo,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, 'base64'),
        contentType: a.contentType,
      })),
    }) as unknown as SendResult
    this.log.info('Email sent', {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    })
    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    }
  }

  close(): void {
    if (this.transporter) {
      this.transporter.close()
      this.transporter = null
    }
  }
}

// -----------------------------------------------------------------------------
// Reply / Forward helpers: fetch original and build proper threaded send opts
// -----------------------------------------------------------------------------

export interface BuildReplyOptions {
  imap: IImapClient
  mailbox: string
  uid: number
  body: { text?: string; html?: string }
  includeQuote: boolean
  replyAll: boolean
  ownAddress: string
}

/**
 * Construye un `SendOptions` para responder a un mensaje preservando hilo.
 *
 * Regla de `to`: usar `Reply-To` si existe (convención para listas/newsletters),
 * de lo contrario el `From` original. Regla de `cc` (reply_all): todos los
 * destinatarios originales menos nuestra propia dirección (evita loop) y los
 * ya incluidos en `to` (evita duplicados en el mismo correo).
 */
export async function buildReplyOptions(
  opts: BuildReplyOptions,
): Promise<SendOptions | null> {
  const { imap, mailbox, uid, body, includeQuote, replyAll, ownAddress } = opts
  const original = await imap.getEmail(mailbox, uid)
  if (!original) return null

  const subject = prefixSubject(original.subject, 'Re: ')
  const to: string[] =
    original.replyTo.length > 0
      ? original.replyTo
      : original.from
        ? [original.from]
        : []
  const cc: string[] = replyAll
    ? [...original.to, ...original.cc].filter(
        (a) => !addrMatches(a, ownAddress) && !isInList(a, to),
      )
    : []

  const refs = collectReferences(original)
  const quoted = includeQuote ? buildQuote(original, body) : body

  return {
    to,
    cc,
    subject,
    ...(quoted.text !== undefined ? { text: quoted.text } : {}),
    ...(quoted.html !== undefined ? { html: quoted.html } : {}),
    ...(original.messageId !== undefined ? { inReplyTo: original.messageId } : {}),
    references: refs,
  }
}

export async function buildForwardOptions(
  imap: IImapClient,
  mailbox: string,
  uid: number,
  to: string[],
  body: { text?: string; html?: string },
  includeAttachments: boolean,
): Promise<SendOptions | null> {
  const original = await imap.getEmail(mailbox, uid)
  if (!original) return null

  const subject = prefixSubject(original.subject, 'Fwd: ')
  const forwarded = buildForwardBody(original, body)

  const attachments: SendOptions['attachments'] = []
  if (includeAttachments && original.attachments.length > 0) {
    for (let i = 0; i < original.attachments.length; i++) {
      const meta = original.attachments[i];
      if (!meta) continue;
      const data = await imap.getAttachment(mailbox, uid, i)
      if (data) {
        attachments.push({
          filename: meta.filename ?? `attachment-${i}`,
          contentBase64: data.base64,
          contentType: meta.contentType,
        })
      }
    }
  }

  return {
    to,
    subject,
    ...(forwarded.text !== undefined ? { text: forwarded.text } : {}),
    ...(forwarded.html !== undefined ? { html: forwarded.html } : {}),
    ...(original.messageId !== undefined ? { inReplyTo: original.messageId } : {}),
    references: collectReferences(original),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

export function prefixSubject(
  subject: string | undefined,
  prefix: string,
): string {
  const s = (subject ?? '').trim()
  if (s.toLowerCase().startsWith(prefix.toLowerCase())) return s
  return `${prefix}${s}`
}

/**
 * Construye el valor del header `References` para mantener el hilo RFC 5322.
 *
 * La cadena acumulada es: todos los `References` previos + el `Message-ID`
 * del mensaje al que respondemos. Parseamos los anteriores como `<id>`
 * separados (pueden venir con saltos de línea y espacios variables).
 */
export function collectReferences(original: EmailFull): string[] {
   
  const refsHeader = original.headers['references'] ?? ''
  const existing: string[] = refsHeader.match(/<[^>]+>/g) ?? []
  if (original.messageId) existing.push(original.messageId)
  return existing
}

function isInList(addr: string, list: string[]): boolean {
  return list.some((a) => addrMatches(a, extractEmail(addr)))
}

function buildQuote(
  original: EmailFull,
  body: { text?: string; html?: string },
): { text: string | undefined; html: string | undefined } {
  const dateStr = original.date ?? ''
  const from = original.from ?? ''
  const header = `On ${dateStr}, ${from} wrote:`
  const text =
    (body.text ?? '') +
    '\n\n' +
    header +
    '\n' +
    (original.textBody ?? '')
      .split('\n')
      .map((line) => '> ' + line)
      .join('\n')
  const htmlQuote =
    original.htmlBody ??
    escapeHtml(original.textBody ?? '').replace(/\n/g, '<br>')
  const html = body.html
    ? `${body.html}<br><br><div>${escapeHtml(header)}</div><blockquote style="border-left:2px solid #ccc;padding-left:8px;margin-left:0;">${htmlQuote}</blockquote>`
    : undefined
  return { text, html }
}

function buildForwardBody(
  original: EmailFull,
  body: { text?: string; html?: string },
): { text: string | undefined; html: string | undefined } {
  const header = [
    '---------- Forwarded message ----------',
    `From: ${original.from ?? ''}`,
    `Date: ${original.date ?? ''}`,
    `Subject: ${original.subject ?? ''}`,
    `To: ${original.to.join(', ')}`,
    '',
  ].join('\n')
  const text =
    (body.text ?? '') + '\n\n' + header + '\n' + (original.textBody ?? '')
  const htmlBody =
    original.htmlBody ??
    escapeHtml(original.textBody ?? '').replace(/\n/g, '<br>')
  const html = body.html
    ? `${body.html}<br><br><div>${escapeHtml(header).replace(/\n/g, '<br>')}</div>${htmlBody}`
    : undefined
  return { text, html }
}

function escapeHtml(s: string): string {
  const MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return s.replace(/[&<>"']/g, (c) => MAP[c] ?? c)
}
