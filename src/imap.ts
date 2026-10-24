/**
 * Cliente IMAP contra Proton Mail Bridge.
 *
 * Por qué `imapflow` en vez de `imap` / `node-imap`: soporte nativo async/await,
 * locks granulares por mailbox, `STARTTLS` correcto y compatibilidad con el
 * servidor IMAP personalizado de Bridge (gluon).
 *
 * Patrones usados:
 *  - **Conexión reutilizable**: `this.client` vive entre llamadas. `connect()`
 *    detecta si el cliente sigue `usable` y lo reutiliza; si cayó, lo tira y
 *    abre uno nuevo con retry + backoff.
 *  - **Mailbox locks**: `getMailboxLock()` garantiza que dos operaciones
 *    simultáneas sobre la misma mailbox (p. ej. list + search) no se pisen.
 *  - **UIDs siempre, seq nunca**: las tools de modificación (flags, move,
 *    delete) reciben UIDs del cliente y los pasan a imapflow con
 *    `{ uid: true }`. Seq numbers cambian entre sesiones; los UIDs no.
 *  - **Body parsing**: fetch con `source: true` → Buffer crudo → `mailparser`
 *    para extraer text/html/attachments. Más lento que fetch parcial, pero
 *    evita decodificar MIME a mano.
 */
import {
  ImapFlow,
  type ImapFlowOptions,
  type ListResponse,
  type FetchQueryObject,
  type SearchObject,
  type FetchMessageObject,
  type MessageEnvelopeObject,
} from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import {
  addrListToString,
  addrListToArray,
  addressesToArray,
} from './addresses.js'
import type { ResolvedBridgeConfig } from './config.js'
import { IMAP_MAX_RETRIES, IMAP_RETRY_BASE_MS, IMAP_MAX_IDLE_MS } from './constants.js'
import { buildTlsOptions } from './tls.js'

export interface EmailSummary {
  uid: number
  seq: number
  messageId: string | undefined
  from: string | undefined
  to: string[]
  subject: string | undefined
  date: string | undefined
  flags: string[]
  size: number | undefined
  snippet?: string
}

export interface EmailFull extends EmailSummary {
  cc: string[]
  bcc: string[]
  replyTo: string[]
  textBody: string | undefined
  htmlBody: string | undefined
  attachments: {
    filename: string | undefined
    contentType: string
    size: number
    contentId: string | undefined
    checksum: string | undefined
  }[]
  headers: Record<string, string>
}

export interface MailboxInfo {
  path: string
  name: string
  delimiter: string
  flags: string[]
  specialUse: string | undefined
  subscribed: boolean
  listed: boolean
}

export class ImapClient {
  private client: ImapFlow | null = null
  private connecting: Promise<ImapFlow> | null = null
  private mailboxListCache: { data: MailboxInfo[]; expires: number } | null = null
  private emailSummaryCache = new Map<
    string,
    {
      data: { items: EmailSummary[]; total?: number; matched?: number }
      expires: number
      /** Mailbox fingerprint (messages:uidNext) — miss cache when mailbox mutates externally. */
      fingerprint: string
    }
  >()

  private static readonly MAILBOX_LIST_TTL_MS = 60_000
  private static readonly EMAIL_SUMMARY_TTL_MS = 30_000

  constructor(
    private readonly cfg: ResolvedBridgeConfig,
    private readonly log: {
      debug: (m: string, e?: unknown) => void
      info: (m: string, e?: unknown) => void
      warn: (m: string, e?: unknown) => void
      error: (m: string, e?: unknown) => void
    },
  ) {}

  private async buildOpts(): Promise<ImapFlowOptions> {
    const resolvedPass = await this.cfg.passwordResolver()
    const security = this.cfg.imapSecurity
    // Default `starttls` (F34): ImapFlow exige STARTTLS; si el servidor no lo
    // ofrece la conexión falla en vez de seguir en claro. `plain` solo para
    // harnesses (GreenMail 2.1.x no anuncia STARTTLS en IMAP :3143).
    // `implicit` = TLS desde el primer byte (IMAPS).
    return {
      host: this.cfg.host,
      port: this.cfg.imapPort,
      secure: security === 'implicit',
      doSTARTTLS: security === 'starttls',
      // Con `PROTON_BRIDGE_CA_PATH` se valida de verdad. Sin ella se avisa.
      tls: buildTlsOptions(this.cfg, this.log),
      auth: { user: this.cfg.user, pass: resolvedPass },
      // Delegamos el logger de imapflow a nuestro logger stderr para que
      // LOG_LEVEL=debug capture la conversación IMAP completa.
      logger: {
        debug: (obj: unknown) => {
          this.log.debug('imapflow', obj)
        },
        info: (obj: unknown) => {
          this.log.info('imapflow', obj)
        },
        warn: (obj: unknown) => {
          this.log.warn('imapflow', obj)
        },
        error: (obj: unknown) => {
          this.log.error('imapflow', obj)
        },
      },
      // Bridge soporta IDLE. Keepalive configurado vía constantes.
      maxIdleTime: IMAP_MAX_IDLE_MS,
    }
  }

  /** Returns a connected, authenticated client. Reuses existing connection when possible. */
  private async connect(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client
    if (this.client && !this.client.usable) {
      this.log.debug('IMAP client no longer usable, discarding')
      this.invalidateAllCaches()
      try {
        await this.client.logout()
      } catch {
        /* noop */
      }
      this.client = null
    }
    if (this.connecting) return this.connecting

    this.connecting = this.connectWithRetry()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  /**
   * Reintenta conectar hasta 3 veces con backoff exponencial (500 ms, 1 s, 2 s).
   *
   * Motivación: en despliegue con Docker Compose / Swarm, Bridge puede
   * tardar unos segundos en estar listo tras un reinicio. Sin retry, la
   * primera llamada después del reinicio falla con `ECONNREFUSED` y el MCP
   * devuelve error al modelo, que lo interpreta como "tool no disponible".
   */
  private async connectWithRetry(): Promise<ImapFlow> {
    const maxAttempts = IMAP_MAX_RETRIES
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const c = new ImapFlow(await this.buildOpts())
        c.on('error', (err) => {
          this.log.error('IMAP error event', { message: err.message })
        })
        c.on('close', () => {
          this.log.debug('IMAP connection closed')
        })
        this.log.debug('Connecting to Proton Bridge IMAP', {
          host: this.cfg.host,
          port: this.cfg.imapPort,
          attempt,
        })
        await c.connect()
        this.log.info('IMAP connected', { attempt })
        this.client = c
        return c
      } catch (err) {
        lastErr = err
        this.log.error('IMAP connect failed', {
          attempt,
          message: (err as Error).message,
        })
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, IMAP_RETRY_BASE_MS * 2 ** (attempt - 1)))
        }
      }
    }
    throw this.describeConnError(lastErr)
  }

  /**
   * Traduce un fallo de conexión a un mensaje accionable para el modelo/humano.
   *
   * Sin esto, los tres modos de fallo más comunes (Bridge apagado, credenciales
   * incorrectas, puerto bloqueado) colapsaban al mismo "IMAP connect failed",
   * que el modelo interpreta como "tool rota". El error original se preserva en
   * `cause`, y el token de causa (ECONNREFUSED/timeout/auth) se incrusta en el
   * mensaje para que sea grepeable y diagnosticable de un vistazo.
   */
  private describeConnError(err: unknown): Error {
    const e = err as
      | { code?: string; message?: string; authenticationFailed?: boolean }
      | undefined
    const code = e?.code ?? ''
    const msg = e?.message ?? ''
    const where = `${this.cfg.host}:${this.cfg.imapPort}`
    const blob = `${code} ${msg}`.toLowerCase()

    let friendly: string
    if (code === 'ECONNREFUSED' || blob.includes('econnrefused')) {
      friendly = `Proton Bridge no escucha IMAP en ${where} (ECONNREFUSED). ¿Está el Bridge corriendo? Lánzalo con 'protonmail-bridge-core --cli' y verifica con 'ss -ltn | grep ${this.cfg.imapPort}'.`
    } else if (blob.includes('no such user')) {
      friendly = `Proton Bridge no reconoce el usuario '${this.cfg.user}' en ${where}. Revisa PROTON_BRIDGE_USER: en la app oficial debe coincidir con la cuenta configurada en Bridge (normalmente tu dirección principal o username de Proton).`
    } else if (
      e?.authenticationFailed ||
      blob.includes('authenticationfailed') ||
      blob.includes('invalid credentials') ||
      blob.includes('auth')
    ) {
      friendly = `Proton Bridge rechazó las credenciales en ${where} (auth). Usa el app-password/mailbox password que genera Bridge para este equipo, NO la contraseña de tu cuenta Proton.`
    } else if (
      code === 'ETIMEDOUT' ||
      blob.includes('timeout') ||
      blob.includes('etimedout')
    ) {
      friendly = `Sin respuesta de Proton Bridge en ${where} (timeout). ¿Host/puerto correctos o firewall bloqueando?`
    } else {
      friendly = `Fallo conectando a Proton Bridge IMAP en ${where}: ${msg || 'error desconocido'}.`
    }
    return new Error(friendly, {
      cause: err instanceof Error ? err : undefined,
    })
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout()
      } catch (err) {
        this.log.debug('IMAP logout error (ignored)', {
          message: (err as Error).message,
        })
      }
      this.client = null
    }
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  private invalidateAllCaches(): void {
    this.mailboxListCache = null
    this.emailSummaryCache.clear()
  }

  private invalidateMailboxSummaries(mailbox: string): void {
    const prefix = `${mailbox}:`
    for (const key of this.emailSummaryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.emailSummaryCache.delete(key)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mailboxes
  // ---------------------------------------------------------------------------

  async listMailboxes(): Promise<MailboxInfo[]> {
    const now = Date.now()
    if (
      this.mailboxListCache &&
      this.mailboxListCache.expires > now &&
      this.client?.usable
    ) {
      return this.mailboxListCache.data
    }
    const c = await this.connect()
    const raw: ListResponse[] = await c.list()
    const data = raw.map((m) => ({
      path: m.path,
      name: m.name,
      delimiter: m.delimiter,
      flags: Array.from(m.flags),
      specialUse: m.specialUse,
      subscribed: m.subscribed,
      listed: m.listed,
    }))
    this.mailboxListCache = {
      data,
      expires: now + ImapClient.MAILBOX_LIST_TTL_MS,
    }
    return data
  }

  async createMailbox(
    path: string,
  ): Promise<{ path: string; created: boolean }> {
    const c = await this.connect()
    const res = await c.mailboxCreate(path)
    this.invalidateAllCaches()
    return { path: res.path, created: res.created }
  }

  async mailboxStatus(path: string): Promise<{
    messages: number
    unseen: number
    recent: number
    uidNext?: number
    uidValidity?: number
  }> {
    const c = await this.connect()
    const s = await c.status(path, {
      messages: true,
      unseen: true,
      recent: true,
      uidNext: true,
      uidValidity: true,
    })
    return {
      messages: s.messages ?? 0,
      unseen: s.unseen ?? 0,
      recent: s.recent ?? 0,
      ...(s.uidNext !== undefined ? { uidNext: s.uidNext } : {}),
      ...(s.uidValidity !== undefined
        ? { uidValidity: Number(s.uidValidity) }
        : {}),
    }
  }

  // ---------------------------------------------------------------------------
  // Listing and searching
  // ---------------------------------------------------------------------------

  /**
   * Lista mensajes recientes (primero los más nuevos) con paginación.
   *
   * Truco: IMAP no tiene un `ORDER BY date DESC LIMIT offset`. Para simular
   * paginación "newest-first" calculamos un rango de seq numbers desde el
   * final (`total - offset`) hacia atrás `limit` posiciones. Esto asume que
   * el orden de seq se corresponde con el orden de llegada — válido en
   * Bridge/Proton, pero si migramos a otro IMAP habría que usar SORT.
   */
  private mailboxFingerprint(status: {
    messages?: number
    uidNext?: number
  }): string {
    return `${status.messages ?? 0}:${status.uidNext ?? 0}`
  }

  async listEmails(
    mailbox: string,
    limit: number,
    offset: number,
  ): Promise<{ items: EmailSummary[]; total: number }> {
    const cacheKey = `${mailbox}:list:${limit}:${offset}`
    const now = Date.now()
    const c = await this.connect()
    // Cheap STATUS before serving cache so external arrivals (SMTP → IMAP)
    // invalidate stale list snapshots within the TTL window.
    const status = await c.status(mailbox, { messages: true, uidNext: true })
    const total = status.messages ?? 0
    const fingerprint = this.mailboxFingerprint(status)
    const cached = this.emailSummaryCache.get(cacheKey)
    if (
      cached &&
      cached.expires > now &&
      cached.fingerprint === fingerprint &&
      cached.data.total !== undefined &&
      this.client?.usable
    ) {
      return { items: cached.data.items, total: cached.data.total }
    }

    const lock = await c.getMailboxLock(mailbox)
    try {
      if (total === 0) return { items: [], total: 0 }

      // Ventana desde el final: si total=1000 y offset=0, end=1000, start=976
      // (25 últimos mensajes). offset=25 → end=975, start=951.
      const end = total - offset
      const start = Math.max(1, end - limit + 1)
      if (end < 1) return { items: [], total }

      const items: EmailSummary[] = []
      for await (const msg of c.fetch(
        `${start}:${end}`,
        this.summaryFetchQuery(),
        { uid: false },
      )) {
        items.push(this.toSummary(msg))
      }
      items.sort((a, b) => b.seq - a.seq)
      this.emailSummaryCache.set(cacheKey, {
        data: { items, total },
        expires: now + ImapClient.EMAIL_SUMMARY_TTL_MS,
        fingerprint,
      })
      return { items, total }
    } finally {
      lock.release()
    }
  }

  async searchEmails(
    mailbox: string,
    criteria: SearchObject,
    limit: number,
  ): Promise<{ items: EmailSummary[]; matched: number }> {
    const cacheKey = `${mailbox}:search:${JSON.stringify(criteria)}:${limit}`
    const now = Date.now()
    const c = await this.connect()
    const status = await c.status(mailbox, { messages: true, uidNext: true })
    const fingerprint = this.mailboxFingerprint(status)
    const cached = this.emailSummaryCache.get(cacheKey)
    if (
      cached &&
      cached.expires > now &&
      cached.fingerprint === fingerprint &&
      cached.data.matched !== undefined &&
      this.client?.usable
    ) {
      return { items: cached.data.items, matched: cached.data.matched }
    }

    const lock = await c.getMailboxLock(mailbox)
    try {
      const searchResult = await c.search(criteria, { uid: true })
      const uids: number[] = Array.isArray(searchResult) ? searchResult : []
      const matched = uids.length
      if (matched === 0) return { items: [], matched }
      // Newest UIDs first
      const sorted = [...uids].sort((a, b) => b - a).slice(0, limit)
      const items: EmailSummary[] = []
      for await (const msg of c.fetch(sorted, this.summaryFetchQuery(), {
        uid: true,
      })) {
        items.push(this.toSummary(msg))
      }
      items.sort((a, b) => b.uid - a.uid)
      this.emailSummaryCache.set(cacheKey, {
        data: { items, matched },
        expires: now + ImapClient.EMAIL_SUMMARY_TTL_MS,
        fingerprint,
      })
      return { items, matched }
    } finally {
      lock.release()
    }
  }

  // ---------------------------------------------------------------------------
  // Full message fetch
  // ---------------------------------------------------------------------------

  async getEmail(mailbox: string, uid: number): Promise<EmailFull | null> {
    const c = await this.connect()
    const lock = await c.getMailboxLock(mailbox)
    try {
      const msg = await c.fetchOne(
        String(uid),
        { source: true, flags: true, envelope: true, uid: true, size: true },
        { uid: true },
      )
      if (!msg || !msg.source) return null
      const parsed = await simpleParser(msg.source)
      return this.toFull(msg, parsed)
    } finally {
      lock.release()
    }
  }

  async getAttachment(
    mailbox: string,
    uid: number,
    index: number,
  ): Promise<{
    filename: string | undefined
    contentType: string
    base64: string
  } | null> {
    const c = await this.connect()
    const lock = await c.getMailboxLock(mailbox)
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) return null
      const parsed = await simpleParser(msg.source)
      const att = parsed.attachments[index]
       
      if (!att) return null
      return {
        filename: att.filename,
        contentType: att.contentType,
        base64: att.content.toString('base64'),
      }
    } finally {
      lock.release()
    }
  }

  // ---------------------------------------------------------------------------
  // Modifications
  // ---------------------------------------------------------------------------

  async setFlags(
    mailbox: string,
    uid: number,
    add: string[],
    remove: string[],
  ): Promise<boolean> {
    const c = await this.connect()
    const lock = await c.getMailboxLock(mailbox)
    try {
      let ok = true
      if (add.length > 0)
        ok = (await c.messageFlagsAdd(String(uid), add, { uid: true })) && ok
      if (remove.length > 0)
        ok =
          (await c.messageFlagsRemove(String(uid), remove, { uid: true })) && ok
      this.invalidateMailboxSummaries(mailbox)
      return ok
    } finally {
      lock.release()
    }
  }

  async moveEmail(
    fromMailbox: string,
    uid: number,
    toMailbox: string,
  ): Promise<boolean> {
    const c = await this.connect()
    const lock = await c.getMailboxLock(fromMailbox)
    try {
      const res = await c.messageMove(String(uid), toMailbox, { uid: true })
      this.invalidateMailboxSummaries(fromMailbox)
      this.invalidateMailboxSummaries(toMailbox)
      return !!res
    } finally {
      lock.release()
    }
  }

  async copyEmail(
    fromMailbox: string,
    uid: number,
    toMailbox: string,
  ): Promise<boolean> {
    const c = await this.connect()
    const lock = await c.getMailboxLock(fromMailbox)
    try {
      const res = await c.messageCopy(String(uid), toMailbox, { uid: true })
      this.invalidateMailboxSummaries(fromMailbox)
      this.invalidateMailboxSummaries(toMailbox)
      return !!res
    } finally {
      lock.release()
    }
  }

  async deleteEmail(mailbox: string, uid: number): Promise<boolean> {
    const c = await this.connect()
    const lock = await c.getMailboxLock(mailbox)
    try {
      const res = await c.messageDelete(String(uid), { uid: true })
      this.invalidateMailboxSummaries(mailbox)
      return res
    } finally {
      lock.release()
    }
  }

  async appendMessage(
    mailbox: string,
    raw: Buffer,
    flags: string[] = [],
  ): Promise<{ uid: number | undefined }> {
    const c = await this.connect()
    const res = await c.append(mailbox, raw, flags)
    this.invalidateMailboxSummaries(mailbox)
    if (!res) return { uid: undefined }
    return { uid: typeof res.uid === 'number' ? res.uid : undefined }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private summaryFetchQuery(): FetchQueryObject {
    return {
      uid: true,
      flags: true,
      envelope: true,
      size: true,
      bodyStructure: false,
    }
  }

  private toSummary(msg: FetchMessageObject): EmailSummary {
    const env: Partial<MessageEnvelopeObject> = msg.envelope ?? {}
    return {
      uid: msg.uid,
      seq: msg.seq,
      messageId: env.messageId,
      from: addrListToString(env.from),
      to: addrListToArray(env.to),
      subject: env.subject,
      date: env.date instanceof Date ? env.date.toISOString() : env.date,
      flags: Array.from(msg.flags ?? []),
      size: msg.size,
    }
  }

  private toFull(msg: FetchMessageObject, parsed: ParsedMail): EmailFull {
    const base = this.toSummary(msg)
    const headers: Record<string, string> = {}
    for (const [k, v] of parsed.headers.entries()) {
      headers[k] = typeof v === 'string' ? v : JSON.stringify(v)
    }
    return {
      ...base,
      cc: addressesToArray(parsed.cc),
      bcc: addressesToArray(parsed.bcc),
      replyTo: addressesToArray(parsed.replyTo),
      textBody: parsed.text ?? undefined,
      htmlBody: typeof parsed.html === 'string' ? parsed.html : undefined,
      attachments: parsed.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        contentId: a.contentId,
        checksum: a.checksum,
      })),
      headers,
    }
  }
}
