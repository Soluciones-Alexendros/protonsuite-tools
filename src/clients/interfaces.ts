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

// ---------------------------------------------------------------------------
// CalendarClient (CalDAV / iCalendar — RFC 4791 / RFC 5545)
// ---------------------------------------------------------------------------

/**
 * CalDAV/ical port.
 *
 * Estado: **BLOQUEADO / seam forward-looking**. Proton Calendar usa sync
 * E2E-encrypted y Proton Mail Bridge aún no expone CalDAV (ver ADR-005). Esta
 * interfaz existe como *seam* anticipada: cuando Bridge añada CalDAV, una
 * implementación CalDAV concreta satisface este contrato sin tocar los
 * consumers. Mientras tanto la capa de tools sigue siendo el *stub* de
 * `src/server/calendar.ts`.
 *
 * Los tipos de valor (`CalendarEvent`, `CalendarListEntry`) son modelos
 * genéricos; se reemplazarán por una lib iCalendar (p. ej. `ical.js` style)
 * cuando exista la implementación. `close()` sigue el patrón de `IImapClient`.
 */
export interface CalendarObject {
  uid: string;
  etag?: string;
  lastModified?: string;
  summary?: string;
}

export interface CalendarEvent extends CalendarObject {
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
}

export interface CalendarListEntry {
  id: string;
  name: string;
  color?: string;
  readOnly?: boolean;
  supportedComponents?: string[];
}

export interface ListEventsOptions {
  calendarId: string;
  start?: string;
  end?: string;
  /** CalDAV `CALDAV:filter` (component, prop-filters, time-range). */
  filter?: Record<string, unknown>;
}

export interface CreateEventOptions {
  calendarId: string;
  event: Omit<CalendarEvent, "uid"> & { uid?: string };
}

export interface ICalendarAdapter {
  listCalendars(): Promise<CalendarListEntry[]>;
  listEvents(opts: ListEventsOptions): Promise<CalendarEvent[]>;
  createEvent(opts: CreateEventOptions): Promise<CalendarEvent>;
  close(): Promise<void>;
}
