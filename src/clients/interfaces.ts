/**
 * Interfaces de abstracción para los clientes de infraestructura.
 *
 * Separan los contratos (qué ofrecen) de las implementaciones (cómo lo hacen).
 * Los consumidores (server/tools, agent/) dependen de estas interfaces en lugar
 * de las clases concretas, cumpliendo el Principio de Inversión de Dependencias.
 *
 * Beneficios:
 *  - Testing: los tests pueden pasar objetos planos en vez de `vi.mock`.
 *  - Extensibilidad: añadir un backend alternativo (ej: gopass) no requiere
 *    tocar ningún consumidor.
 *  - Documentación: la interfaz describe el contrato completo del módulo.
 */

import type { EmailSummary, EmailFull, MailboxInfo } from '../imap.js'
import type { PassAuditResult } from '../pass.js'
import type { SendOptions, SendResult } from '../smtp.js'

// ---------------------------------------------------------------------------
// ImapClient
// ---------------------------------------------------------------------------

export interface IImapClient {
  listMailboxes(): Promise<MailboxInfo[]>
  createMailbox(path: string): Promise<{ path: string; created: boolean }>
  mailboxStatus(
    path: string,
  ): Promise<{
    messages: number
    unseen: number
    recent: number
    uidNext?: number
    uidValidity?: number
  }>
  listEmails(
    mailbox: string,
    limit: number,
    offset: number,
  ): Promise<{ items: EmailSummary[]; total: number }>
  searchEmails(
    mailbox: string,
    criteria: Record<string, unknown>,
    limit: number,
  ): Promise<{ items: EmailSummary[]; matched: number }>
  getEmail(mailbox: string, uid: number): Promise<EmailFull | null>
  getAttachment(
    mailbox: string,
    uid: number,
    index: number,
  ): Promise<{
    filename: string | undefined
    contentType: string
    base64: string
  } | null>
  setFlags(
    mailbox: string,
    uid: number,
    add: string[],
    remove: string[],
  ): Promise<boolean>
  moveEmail(fromMailbox: string, uid: number, toMailbox: string): Promise<boolean>
  copyEmail(fromMailbox: string, uid: number, toMailbox: string): Promise<boolean>
  deleteEmail(mailbox: string, uid: number): Promise<boolean>
  appendMessage(
    mailbox: string,
    raw: Buffer,
    flags?: string[],
  ): Promise<{ uid: number | undefined }>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// SmtpClient
// ---------------------------------------------------------------------------

export interface ISmtpClient {
  send(opts: SendOptions): Promise<SendResult>
  close(): void
}

// ---------------------------------------------------------------------------
// DriveClient
// ---------------------------------------------------------------------------

export interface IDriveClient {
  readonly stagingDir: string
  execCli(args: string[]): Promise<{ stdout: string; stderr: string }>
  checkDeps(): { ok: boolean; version?: string; error?: string }
  listFiles(remotePath: string): Promise<{ ok: boolean; files: { name?: string; path?: string; size?: number; type?: string; modified?: string }[]; raw: string; error?: string }>
  download(remotePath: string, localPath?: string): Promise<{ ok: boolean; remotePath: string; localPath: string; error?: string }>
  upload(localPath?: string, remotePath?: string): Promise<{ ok: boolean; localPath: string; remotePath: string; error?: string }>
  share(remotePath: string, userEmail: string): Promise<{ ok: boolean; remotePath: string; userEmail: string; error?: string }>
  status(): Promise<{ ok: boolean; configured: boolean; authenticated?: boolean; stagingExists: boolean; stagingFiles?: number; stagingBytes?: number; cliPath: string; error?: string }>
  moveFiles(from: string, to: string): Promise<{ ok: boolean; error?: string }>
  copyFiles(from: string, to: string): Promise<{ ok: boolean; error?: string }>
  mkdir(remotePath: string): Promise<{ ok: boolean; error?: string }>
  removeFiles(remotePath: string): Promise<{ ok: boolean; error?: string }>
  opts: { cliBin: string; stagingDir: string; obsoleteExtensions: string[] }
}

// ---------------------------------------------------------------------------
// PassClient
// ---------------------------------------------------------------------------

export interface IPassClient {
  get(name: string): Promise<string>
  list(subdir?: string): Promise<string[]>
  audit(): Promise<PassAuditResult>
  health(): Promise<{ ok: boolean; entries: number; error?: string }>
}
