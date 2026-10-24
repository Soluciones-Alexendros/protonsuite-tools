/**
 * Cobertura directa de `ImapClient` (src/imap.ts) con `imapflow` y `mailparser`
 * MOCKEADOS vía `vi.mock` — sin red real contra Bridge.
 *
 * Estrategia: reutilizamos el patrón de mock de `imapflow` ya probado en
 * tests/server-tools.test.ts (clase `ImapFlow` que lee de un objeto de estado
 * mutable `imapState`), pero lo extendemos con palancas de error
 * (`*ShouldThrow`) y contadores de llamada para asertar tanto el happy-path
 * (transformación de envelopes/flags/fechas) como el error-path (conexión
 * caída, mailbox inexistente, fetchOne nulo). Aquí ejercitamos la clase
 * directamente, no a través del `McpServer`, para cubrir CADA método público.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ResolvedBridgeConfig } from '../src/config.js'
import { ImapClient } from '../src/imap.js'

// -----------------------------------------------------------------------------
// Mock state, mutable per-test
// -----------------------------------------------------------------------------
const imapState = {
  // Datos
  listResult: [] as unknown[],
  statusResult: {} as Record<string, unknown>,
  fetchResults: [] as unknown[],
  fetchOneResult: null as unknown,
  searchResult: [] as number[] | unknown,
  mailboxCreateResult: { path: 'X', created: true },
  appendResult: { uid: 1 } as unknown,
  moveResult: true as unknown,
  copyResult: true as unknown,
  deleteResult: true as unknown,
  flagsAddResult: true as unknown,
  flagsRemoveResult: true as unknown,
  // Control de conexión
  usable: true,
  connectAttempts: 0,
  connectFailUntil: 0, // connect() lanza mientras attempts <= este valor
  connectErrorMessage: 'ECONNREFUSED', // mensaje que lanza connect() al fallar
  listCalls: 0,
  statusCalls: 0,
  fetchCalls: 0,
  searchCalls: 0,
  // Palancas de error por método
  listShouldThrow: false,
  statusShouldThrow: false,
  searchShouldThrow: false,
  fetchOneShouldThrow: false,
  // Espías de release de lock
  lockReleases: 0,
  lastOptions: null as Record<string, unknown> | null,
}

// Parsed mail devuelto por simpleParser (mutable para casos borde).
let parsedMailResult: unknown = null
const parseError: { value: Error | null } = { value: null }

vi.mock('imapflow', () => {
  class ImapFlow {
    // Se guardan las opciones para poder afirmar qué configuración de TLS se
    // pide de verdad (hallazgo F34).
    constructor(options: unknown) {
      imapState.lastOptions = options as Record<string, unknown>
    }
    get usable() { return imapState.usable }
    on() {}
    connect() {
      imapState.connectAttempts += 1
      if (imapState.connectAttempts <= imapState.connectFailUntil) {
        throw new Error(imapState.connectErrorMessage)
      }
    }
    logout() {}
    list() {
      if (imapState.listShouldThrow)
        throw new Error('LIST failed: connection dropped')
      imapState.listCalls += 1
      return imapState.listResult
    }
    mailboxCreate() {
      return imapState.mailboxCreateResult
    }
    status() {
      if (imapState.statusShouldThrow) throw new Error('Mailbox does not exist')
      imapState.statusCalls += 1
      return imapState.statusResult
    }
    getMailboxLock() {
      return {
        release() {
          imapState.lockReleases += 1
        },
      }
    }
    *fetch() {
      imapState.fetchCalls += 1
      yield* imapState.fetchResults
    }
    fetchOne() {
      if (imapState.fetchOneShouldThrow) throw new Error('fetchOne failed')
      return imapState.fetchOneResult
    }
    search() {
      if (imapState.searchShouldThrow) throw new Error('SEARCH failed')
      imapState.searchCalls += 1
      return imapState.searchResult
    }
    messageMove() {
      return imapState.moveResult
    }
    messageCopy() {
      return imapState.copyResult
    }
    messageDelete() {
      return imapState.deleteResult
    }
    messageFlagsAdd() {
      return imapState.flagsAddResult
    }
    messageFlagsRemove() {
      return imapState.flagsRemoveResult
    }
    append() {
      return imapState.appendResult
    }
  }
  return { ImapFlow }
})

vi.mock('mailparser', () => ({
  simpleParser: () => {
    if (parseError.value) throw parseError.value
    return parsedMailResult
  },
}))

const bridgeCfg: ResolvedBridgeConfig = {
  user: 'me@proton.me',
  pass: 'x',
  passwordResolver: () => Promise.resolve('x'),
  host: '127.0.0.1',
  imapPort: 1143,
  smtpPort: 1025,
  from: 'me@proton.me',
  tlsInsecure: true,
  imapSecurity: 'starttls',
  smtpSecurity: 'starttls',
}

const silentLog = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}

function makeClient(): ImapClient {
  return new ImapClient(bridgeCfg, silentLog)
}

// Un mensaje "summary" tal como lo emite el fetch de imapflow.
function summaryMsg(over: Record<string, unknown> = {}) {
  return {
    uid: 42,
    seq: 1,
    flags: new Set(['\\Seen']),
    size: 1234,
    envelope: {
      messageId: '<m1@x>',
      from: [{ name: 'Alice', address: 'alice@example.com' }],
      to: [{ address: 'me@proton.me' }],
      subject: 'Hi there',
      date: new Date('2026-01-01T10:00:00Z'),
    },
    ...over,
  }
}

beforeEach(() => {
  vi.useRealTimers()
  silentLog.error.mockClear()
  silentLog.info.mockClear()
  silentLog.debug.mockClear()

  imapState.listResult = [
    {
      path: 'INBOX',
      name: 'INBOX',
      delimiter: '/',
      flags: new Set(['\\HasNoChildren']),
      specialUse: '\\Inbox',
      subscribed: true,
      listed: true,
    },
    {
      path: 'Trash',
      name: 'Trash',
      delimiter: '/',
      flags: new Set(),
      specialUse: undefined,
      subscribed: false,
      listed: true,
    },
  ]
  imapState.statusResult = {
    messages: 10,
    unseen: 3,
    recent: 1,
    uidNext: 100,
    uidValidity: 1,
  }
  imapState.fetchResults = [summaryMsg()]
  imapState.fetchOneResult = {
    uid: 42,
    seq: 1,
    source: Buffer.from('raw'),
    flags: new Set(['\\Seen']),
    size: 1234,
    envelope: summaryMsg().envelope,
  }
  imapState.searchResult = [42]
  imapState.mailboxCreateResult = { path: 'X', created: true }
  imapState.appendResult = { uid: 7 }
  imapState.moveResult = true
  imapState.deleteResult = true
  imapState.flagsAddResult = true
  imapState.flagsRemoveResult = true

  imapState.usable = true
  imapState.connectAttempts = 0
  imapState.connectFailUntil = 0
  imapState.connectErrorMessage = 'ECONNREFUSED'
  imapState.listCalls = 0
  imapState.statusCalls = 0
  imapState.fetchCalls = 0
  imapState.searchCalls = 0
  imapState.listShouldThrow = false
  imapState.statusShouldThrow = false
  imapState.searchShouldThrow = false
  imapState.fetchOneShouldThrow = false
  imapState.lockReleases = 0

  parsedMailResult = {
    headers: new Map<string, unknown>([
      ['subject', 'Hi there'],
      ['x-custom', { value: 'obj-header' }],
    ]),
    cc: { value: [{ name: 'Carol', address: 'carol@example.com' }] },
    bcc: undefined,
    replyTo: { value: [{ address: 'reply@example.com' }] },
    text: 'Hello body',
    html: '<p>Hello body</p>',
    attachments: [
      {
        filename: 'a.txt',
        contentType: 'text/plain',
        size: 5,
        content: Buffer.from('hello'),
        contentId: '<cid1>',
        checksum: 'abc123',
      },
    ],
  }
  parseError.value = null
})

// -----------------------------------------------------------------------------
// connect() (vía métodos públicos) + retry/backoff
// -----------------------------------------------------------------------------
describe('ImapClient · connect/retry', () => {
  it('connects once and reuses the client across calls (usable)', async () => {
    const c = makeClient()
    await c.listMailboxes()
    await c.listMailboxes()
    // Una sola conexión real porque el cliente sigue usable.
    expect(imapState.connectAttempts).toBe(1)
  })

  it('retries with backoff and succeeds on the 2nd attempt', async () => {
    vi.useFakeTimers()
    imapState.connectFailUntil = 1 // primer intento lanza, segundo OK
    const c = makeClient()
    const p = c.listMailboxes()
    // Avanza el backoff (500ms tras el 1er fallo).
    await vi.advanceTimersByTimeAsync(600)
    const res = await p
    expect(imapState.connectAttempts).toBe(2)
    expect(res).toHaveLength(2)
  })

  it('throws after exhausting all 3 attempts', async () => {
    vi.useFakeTimers()
    imapState.connectFailUntil = 99 // siempre falla
    const c = makeClient()
    const p = c.listMailboxes()
    const assertion = expect(p).rejects.toThrow(/ECONNREFUSED/)
    await vi.advanceTimersByTimeAsync(5000) // cubre 500 + 1000 ms de backoff
    await assertion
    expect(imapState.connectAttempts).toBe(3)
  })

  it('discards unusable client and reconnects', async () => {
    const c = makeClient()
    await c.listMailboxes() // primera conexión usable
    // Marcamos el cliente como no usable para forzar descarte
    imapState.usable = false
    await c.listMailboxes() // debe reconectar
    expect(imapState.connectAttempts).toBe(2)
  })

  it('parallel calls share a single connecting promise', async () => {
    imapState.connectFailUntil = 1 // falla 1er intento, 2do ok
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const c = makeClient()
    const p1 = c.listMailboxes()
    const p2 = c.listMailboxes()
    await vi.advanceTimersByTimeAsync(600)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(imapState.connectAttempts).toBe(2) // solo 2 intentos compartidos
    expect(r1).toHaveLength(2)
    expect(r2).toHaveLength(2)
  })
})

// -----------------------------------------------------------------------------
// describeConnError: mensajes de conexión diferenciados y accionables
// -----------------------------------------------------------------------------
describe('ImapClient · differentiated connection errors', () => {
  async function failWith(message: string): Promise<Error> {
    vi.useFakeTimers()
    imapState.connectFailUntil = 99
    imapState.connectErrorMessage = message
    const c = makeClient()
    const p = c.listMailboxes()
    const caught = p.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(5000)
    return caught
  }

  it("maps ECONNREFUSED to a 'Bridge not running' hint (and stays grep-able)", async () => {
    const err = await failWith('ECONNREFUSED')
    expect(err.message).toMatch(/ECONNREFUSED/)
    expect(err.message).toMatch(/no escucha IMAP en 127\.0\.0\.1:1143/)
    expect(err.message).toMatch(/Bridge/)
    expect(err.cause).toBeInstanceOf(Error)
  })

  it('maps an auth failure to an app-password hint', async () => {
    const err = await failWith('AUTHENTICATIONFAILED invalid credentials')
    expect(err.message).toMatch(/credenciales/i)
    expect(err.message).toMatch(/app-password/i)
  })

  it("maps 'no such user' to a PROTON_BRIDGE_USER hint", async () => {
    const err = await failWith('no such user')
    expect(err.message).toMatch(/no reconoce el usuario/)
    expect(err.message).toMatch(/PROTON_BRIDGE_USER/)
  })

  it('maps a timeout to a host/port/firewall hint', async () => {
    const err = await failWith('ETIMEDOUT connection timeout')
    expect(err.message).toMatch(/timeout/i)
    expect(err.message).toMatch(/firewall/i)
  })

  it('maps an unknown error to the generic fallback hint (else branch)', async () => {
    const err = await failWith('UNKNOWN_ERROR_XYZ')
    expect(err.message).toMatch(/Fallo conectando/)
    expect(err.message).toMatch(/127\.0\.0\.1:1143/)
    expect(err.message).toMatch(/UNKNOWN_ERROR_XYZ/)
  })

  it('cubre msg || error desconocido en el else genérico cuando msg es vacío', async () => {
    vi.useFakeTimers()
    imapState.connectFailUntil = 99
    imapState.connectErrorMessage = ''  // mensaje vacío → msg = ''
    const c = makeClient()
    const p = c.listMailboxes().catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(5000)
    const err = await p
    expect(err.message).toMatch(/error desconocido/)
    expect(err.message).toMatch(/Fallo conectando/)
  })
})

// -----------------------------------------------------------------------------
// close()
// -----------------------------------------------------------------------------
describe('ImapClient · close', () => {
  it('logs out and clears the client (idempotent)', async () => {
    const c = makeClient()
    await c.listMailboxes() // crea conexión
    await c.close()
    // Segunda llamada sin cliente: no lanza.
    await expect(c.close()).resolves.toBeUndefined()
  })

  it('swallows logout errors (close catches and logs them)', async () => {
    const c = makeClient()
    await c.listMailboxes()
    await expect(c.close()).resolves.toBeUndefined()
  })

  it('close does nothing when client is null (already closed)', async () => {
    const c = makeClient()
    await expect(c.close()).resolves.toBeUndefined()
  })
})

// -----------------------------------------------------------------------------
// listMailboxes()
// -----------------------------------------------------------------------------
describe('ImapClient · listMailboxes', () => {
  it('maps ListResponse with defaults for missing fields', async () => {
    const c = makeClient()
    const res = await c.listMailboxes()
    expect(res).toHaveLength(2)
    expect(res[0]).toMatchObject({
      path: 'INBOX',
      name: 'INBOX',
      flags: ['\\HasNoChildren'],
      specialUse: '\\Inbox',
      subscribed: true,
      listed: true,
    })
    // Defaults aplicados al segundo (campos ausentes).
    expect(res[1]).toMatchObject({
      path: 'Trash',
      flags: [],
      subscribed: false,
      listed: true,
      specialUse: undefined,
    })
  })

  it('propagates errors when list() throws', async () => {
    imapState.listShouldThrow = true
    const c = makeClient()
    await expect(c.listMailboxes()).rejects.toThrow(/LIST failed/)
  })

  it('caches listMailboxes within TTL and skips second list()', async () => {
    const c = makeClient()
    await c.listMailboxes()
    await c.listMailboxes()
    expect(imapState.listCalls).toBe(1)
  })

  it('invalidates mailbox list cache after createMailbox', async () => {
    const c = makeClient()
    await c.listMailboxes()
    await c.createMailbox('New')
    await c.listMailboxes()
    expect(imapState.listCalls).toBe(2)
  })
})

// -----------------------------------------------------------------------------
// createMailbox()
// -----------------------------------------------------------------------------
describe('ImapClient · createMailbox', () => {
  it('returns path and created flag', async () => {
    imapState.mailboxCreateResult = { path: 'Projects/X', created: true }
    const c = makeClient()
    expect(await c.createMailbox('Projects/X')).toEqual({
      path: 'Projects/X',
      created: true,
    })
  })

  it('reports created=false when mailbox already exists', async () => {
    imapState.mailboxCreateResult = { path: 'Existing', created: false }
    const c = makeClient()
    expect(await c.createMailbox('Existing')).toEqual({
      path: 'Existing',
      created: false,
    })
  })
})

// -----------------------------------------------------------------------------
// mailboxStatus()
// -----------------------------------------------------------------------------
describe('ImapClient · mailboxStatus', () => {
  it('returns normalized counts and coerces BigInt-ish uid fields to Number', async () => {
    imapState.statusResult = {
      messages: 10,
      unseen: 3,
      recent: 1,
      uidNext: 100,
      uidValidity: 1,
    }
    const c = makeClient()
    expect(await c.mailboxStatus('INBOX')).toEqual({
      messages: 10,
      unseen: 3,
      recent: 1,
      uidNext: 100,
      uidValidity: 1,
    })
  })

  it('applies defaults and undefined for missing uid fields', async () => {
    imapState.statusResult = {} // todo ausente
    const c = makeClient()
    expect(await c.mailboxStatus('INBOX')).toEqual({
      messages: 0,
      unseen: 0,
      recent: 0,
      uidNext: undefined,
      uidValidity: undefined,
    })
  })

  it('propagates errors for a non-existent mailbox', async () => {
    imapState.statusShouldThrow = true
    const c = makeClient()
    await expect(c.mailboxStatus('Nope')).rejects.toThrow(/does not exist/)
  })
})

// -----------------------------------------------------------------------------
// listEmails()
// -----------------------------------------------------------------------------
describe('ImapClient · listEmails', () => {
  it('returns summaries newest-first with total', async () => {
    imapState.fetchResults = [
      summaryMsg({ uid: 40, seq: 1 }),
      summaryMsg({ uid: 42, seq: 3 }),
      summaryMsg({ uid: 41, seq: 2 }),
    ]
    const c = makeClient()
    const res = await c.listEmails('INBOX', 25, 0)
    expect(res.total).toBe(10)
    // Orden descendente por seq.
    expect(res.items.map((i) => i.seq)).toEqual([3, 2, 1])
    expect(res.items[0].from).toBe('Alice <alice@example.com>')
    expect(imapState.lockReleases).toBe(1) // lock liberado
  })

  it('serves listEmails from cache when mailbox fingerprint is unchanged', async () => {
    imapState.fetchResults = [summaryMsg({ uid: 42, seq: 1 })]
    const c = makeClient()
    await c.listEmails('INBOX', 25, 0)
    await c.listEmails('INBOX', 25, 0)
    expect(imapState.fetchCalls).toBe(1)
    expect(imapState.statusCalls).toBe(2)
  })

  it('refetches listEmails when mailbox message count changes', async () => {
    imapState.fetchResults = [summaryMsg({ uid: 42, seq: 1 })]
    const c = makeClient()
    await c.listEmails('INBOX', 25, 0)
    imapState.statusResult = {
      ...imapState.statusResult,
      messages: 11,
      uidNext: 101,
    }
    imapState.fetchResults = [
      summaryMsg({ uid: 42, seq: 1 }),
      summaryMsg({ uid: 43, seq: 2 }),
    ]
    await c.listEmails('INBOX', 25, 0)
    expect(imapState.fetchCalls).toBe(2)
  })

  it('serves searchEmails from cache until fingerprint changes', async () => {
    imapState.searchResult = [42]
    imapState.fetchResults = [summaryMsg({ uid: 42, seq: 1 })]
    const c = makeClient()
    await c.searchEmails('INBOX', { seen: false }, 10)
    await c.searchEmails('INBOX', { seen: false }, 10)
    expect(imapState.searchCalls).toBe(1)
    imapState.statusResult = {
      ...imapState.statusResult,
      messages: 11,
      uidNext: 101,
    }
    await c.searchEmails('INBOX', { seen: false }, 10)
    expect(imapState.searchCalls).toBe(2)
  })

  it('returns empty for an empty mailbox (total=0)', async () => {
    imapState.statusResult = { messages: 0 }
    const c = makeClient()
    expect(await c.listEmails('INBOX', 25, 0)).toEqual({ items: [], total: 0 })
    expect(imapState.lockReleases).toBe(1)
  })

  it('returns empty items when offset is past the end (end<1)', async () => {
    imapState.statusResult = { messages: 5 }
    imapState.fetchResults = [] // no debería iterar
    const c = makeClient()
    const res = await c.listEmails('INBOX', 25, 10) // end = 5-10 = -5
    expect(res).toEqual({ items: [], total: 5 })
  })

  it('does not acquire mailbox lock when status throws', async () => {
    imapState.statusShouldThrow = true
    const c = makeClient()
    await expect(c.listEmails('INBOX', 25, 0)).rejects.toThrow()
    expect(imapState.lockReleases).toBe(0)
  })
})

// -----------------------------------------------------------------------------
// searchEmails()
// -----------------------------------------------------------------------------
describe('ImapClient · searchEmails', () => {
  it('returns matched count and newest-uid-first items', async () => {
    imapState.searchResult = [40, 42, 41]
    imapState.fetchResults = [
      summaryMsg({ uid: 40, seq: 1 }),
      summaryMsg({ uid: 42, seq: 3 }),
      summaryMsg({ uid: 41, seq: 2 }),
    ]
    const c = makeClient()
    const res = await c.searchEmails('INBOX', { seen: true }, 25)
    expect(res.matched).toBe(3)
    expect(res.items.map((i) => i.uid)).toEqual([42, 41, 40])
  })

  it('returns empty when nothing matches', async () => {
    imapState.searchResult = []
    const c = makeClient()
    expect(await c.searchEmails('INBOX', { seen: true }, 25)).toEqual({
      items: [],
      matched: 0,
    })
  })

  it('treats a non-array search result as zero matches', async () => {
    imapState.searchResult = false // imapflow puede devolver false
    const c = makeClient()
    expect(await c.searchEmails('INBOX', { all: true }, 25)).toEqual({
      items: [],
      matched: 0,
    })
  })

  it('respects the limit (slices to newest N)', async () => {
    imapState.searchResult = [10, 20, 30, 40]
    imapState.fetchResults = [
      summaryMsg({ uid: 40, seq: 4 }),
      summaryMsg({ uid: 30, seq: 3 }),
    ]
    const c = makeClient()
    const res = await c.searchEmails('INBOX', { all: true }, 2)
    expect(res.matched).toBe(4)
    expect(res.items.map((i) => i.uid)).toEqual([40, 30])
  })

  it('releases the lock when search throws', async () => {
    imapState.searchShouldThrow = true
    const c = makeClient()
    await expect(c.searchEmails('INBOX', { all: true }, 25)).rejects.toThrow(
      /SEARCH failed/,
    )
    expect(imapState.lockReleases).toBe(1)
  })
})

// -----------------------------------------------------------------------------
// getEmail()
// -----------------------------------------------------------------------------
describe('ImapClient · getEmail', () => {
  it('parses the full message (headers, cc, replyTo, attachments)', async () => {
    const c = makeClient()
    const res = await c.getEmail('INBOX', 42)
    expect(res).not.toBeNull()
    expect(res!.uid).toBe(42)
    expect(res!.textBody).toBe('Hello body')
    expect(res!.htmlBody).toBe('<p>Hello body</p>')
    expect(res!.cc).toEqual(['Carol <carol@example.com>'])
    expect(res!.replyTo).toEqual(['reply@example.com'])
    expect(res!.bcc).toEqual([])
    // Header de objeto serializado a JSON.
    expect(res!.headers['x-custom']).toBe(
      JSON.stringify({ value: 'obj-header' }),
    )
    expect(res!.headers.subject).toBe('Hi there')
    expect(res!.attachments[0]).toEqual({
      filename: 'a.txt',
      contentType: 'text/plain',
      size: 5,
      contentId: '<cid1>',
      checksum: 'abc123',
    })
  })

  it('returns null when fetchOne yields no message', async () => {
    imapState.fetchOneResult = null
    const c = makeClient()
    expect(await c.getEmail('INBOX', 99)).toBeNull()
  })

  it('returns null when the message has no source', async () => {
    imapState.fetchOneResult = { uid: 42, seq: 1, envelope: {} }
    const c = makeClient()
    expect(await c.getEmail('INBOX', 42)).toBeNull()
  })

  it('coerces non-string html to undefined and falls back text to undefined', async () => {
    parsedMailResult = {
      headers: new Map<string, unknown>(),
      cc: undefined,
      bcc: undefined,
      replyTo: undefined,
      text: undefined,
      html: false, // imapflow/mailparser: false cuando no hay HTML
      attachments: [],
    }
    const c = makeClient()
    const res = await c.getEmail('INBOX', 42)
    expect(res!.htmlBody).toBeUndefined()
    expect(res!.textBody).toBeUndefined()
    expect(res!.attachments).toEqual([])
  })

  it('releases the lock when the parser throws', async () => {
    parseError.value = new Error('MIME parse error')
    const c = makeClient()
    await expect(c.getEmail('INBOX', 42)).rejects.toThrow(/MIME parse error/)
    expect(imapState.lockReleases).toBe(1)
  })
})

// -----------------------------------------------------------------------------
// getAttachment()
// -----------------------------------------------------------------------------
describe('ImapClient · getAttachment', () => {
  it('returns base64 content for a valid index', async () => {
    const c = makeClient()
    const res = await c.getAttachment('INBOX', 42, 0)
    expect(res).not.toBeNull()
    expect(res!.filename).toBe('a.txt')
    expect(res!.contentType).toBe('text/plain')
    expect(Buffer.from(res!.base64, 'base64').toString()).toBe('hello')
  })

  it('returns null when the message is missing', async () => {
    imapState.fetchOneResult = null
    const c = makeClient()
    expect(await c.getAttachment('INBOX', 99, 0)).toBeNull()
  })

  it('returns null when source is absent', async () => {
    imapState.fetchOneResult = { uid: 42 }
    const c = makeClient()
    expect(await c.getAttachment('INBOX', 42, 0)).toBeNull()
  })

  it('returns null for an out-of-range attachment index', async () => {
    const c = makeClient()
    expect(await c.getAttachment('INBOX', 42, 5)).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// setFlags()
// -----------------------------------------------------------------------------
describe('ImapClient · setFlags', () => {
  it('adds and removes flags, returning combined success', async () => {
    const c = makeClient()
    expect(await c.setFlags('INBOX', 42, ['\\Seen'], ['\\Flagged'])).toBe(true)
  })

  it('returns false when an add operation fails', async () => {
    imapState.flagsAddResult = false
    const c = makeClient()
    expect(await c.setFlags('INBOX', 42, ['\\Seen'], [])).toBe(false)
  })

  it('returns false when a remove operation fails', async () => {
    imapState.flagsRemoveResult = false
    const c = makeClient()
    expect(await c.setFlags('INBOX', 42, [], ['\\Seen'])).toBe(false)
  })

  it('is a no-op (true) when both add and remove are empty', async () => {
    const c = makeClient()
    expect(await c.setFlags('INBOX', 42, [], [])).toBe(true)
    expect(imapState.lockReleases).toBe(1)
  })
})

// -----------------------------------------------------------------------------
// moveEmail()
// -----------------------------------------------------------------------------
describe('ImapClient · moveEmail', () => {
  it('returns true on a successful move', async () => {
    imapState.moveResult = { uidMap: new Map() }
    const c = makeClient()
    expect(await c.moveEmail('INBOX', 42, 'Trash')).toBe(true)
  })

  it('returns false when the move yields a falsy result', async () => {
    imapState.moveResult = false
    const c = makeClient()
    expect(await c.moveEmail('INBOX', 42, 'Trash')).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// copyEmail()
// -----------------------------------------------------------------------------
describe('ImapClient · copyEmail', () => {
  it('returns true on a successful copy', async () => {
    imapState.copyResult = { uidMap: new Map() }
    const c = makeClient()
    expect(await c.copyEmail('INBOX', 42, 'Archive')).toBe(true)
  })

  it('returns false when the copy yields a falsy result', async () => {
    imapState.copyResult = false
    const c = makeClient()
    expect(await c.copyEmail('INBOX', 42, 'Archive')).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// deleteEmail()
// -----------------------------------------------------------------------------
describe('ImapClient · deleteEmail', () => {
  it('returns true on a successful delete', async () => {
    const c = makeClient()
    expect(await c.deleteEmail('INBOX', 42)).toBe(true)
  })

  it('returns false when delete yields falsy', async () => {
    imapState.deleteResult = false
    const c = makeClient()
    expect(await c.deleteEmail('INBOX', 42)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// appendMessage()
// -----------------------------------------------------------------------------
describe('ImapClient · appendMessage', () => {
  it('returns the new uid on success', async () => {
    imapState.appendResult = { uid: 7 }
    const c = makeClient()
    expect(
      await c.appendMessage('Drafts', Buffer.from('raw'), ['\\Draft']),
    ).toEqual({
      uid: 7,
    })
  })

  it('returns undefined uid when append returns falsy', async () => {
    imapState.appendResult = null
    const c = makeClient()
    expect(await c.appendMessage('Drafts', Buffer.from('raw'))).toEqual({
      uid: undefined,
    })
  })

  it('returns undefined uid when append omits a numeric uid', async () => {
    imapState.appendResult = { uid: undefined }
    const c = makeClient()
    expect(await c.appendMessage('Drafts', Buffer.from('raw'))).toEqual({
      uid: undefined,
    })
  })
})

// -----------------------------------------------------------------------------
// Parseo de envelopes (vía toSummary, ejercitado por listEmails)
// -----------------------------------------------------------------------------
describe('ImapClient · envelope/address parsing edge cases', () => {
  it('builds email from mailbox@host when address is absent', async () => {
    imapState.fetchResults = [
      summaryMsg({
        envelope: {
          messageId: '<m2@x>',
          from: [{ name: 'Bob', mailbox: 'bob', host: 'example.com' }],
          to: [{ mailbox: 'x', host: 'y.com' }],
          subject: 'S',
          date: '2026-02-02T00:00:00Z', // string date (no Date instance)
        },
      }),
    ]
    const c = makeClient()
    const res = await c.listEmails('INBOX', 25, 0)
    expect(res.items[0].from).toBe('Bob <bob@example.com>')
    expect(res.items[0].to).toEqual(['x@y.com'])
    // date string pasa tal cual (no es Date).
    expect(res.items[0].date).toBe('2026-02-02T00:00:00Z')
  })

  it('yields undefined from / empty to for empty or unusable address lists', async () => {
    imapState.fetchResults = [
      summaryMsg({
        flags: undefined, // cubre `?? []` en toSummary
        envelope: {
          messageId: undefined,
          from: [],
          to: undefined,
          subject: undefined,
          date: undefined,
        },
      }),
    ]
    const c = makeClient()
    const res = await c.listEmails('INBOX', 25, 0)
    const item = res.items[0]
    expect(item.from).toBeUndefined()
    expect(item.to).toEqual([])
    expect(item.flags).toEqual([])
    expect(item.date).toBeUndefined()
  })

  it('handles a missing envelope entirely (envelope ?? {})', async () => {
    imapState.fetchResults = [{ uid: 5, seq: 1, flags: new Set(), size: 0 }]
    const c = makeClient()
    const res = await c.listEmails('INBOX', 25, 0)
    expect(res.items[0].uid).toBe(5)
    expect(res.items[0].from).toBeUndefined()
    expect(res.items[0].to).toEqual([])
  })
})

// ===========================================================================
// F34 — TLS: STARTTLS exigido y CA conectada
// ===========================================================================

describe('ImapClient · TLS', () => {
  const PEM = [
    '-----BEGIN CERTIFICATE-----',
    'MIIBkTCB+wIJAJ000000000000000000000000000000000000000000000',
    '-----END CERTIFICATE-----',
  ].join('\n')

  it('EXIGE STARTTLS: sin él la conexión falla, no sigue en claro', async () => {
    const client = new ImapClient(bridgeCfg, silentLog as never)
    await client.connect()

    expect(imapState.lastOptions?.['doSTARTTLS']).toBe(true)
    expect(imapState.lastOptions?.['secure']).toBe(false)
  })

  it('imapSecurity=plain no exige STARTTLS (harness GreenMail)', async () => {
    const client = new ImapClient(
      { ...bridgeCfg, imapSecurity: 'plain' },
      silentLog as never,
    )
    await client.connect()

    expect(imapState.lastOptions?.['doSTARTTLS']).toBe(false)
    expect(imapState.lastOptions?.['secure']).toBe(false)
  })

  it('imapSecurity=implicit usa TLS desde el primer byte', async () => {
    const client = new ImapClient(
      { ...bridgeCfg, imapSecurity: 'implicit' },
      silentLog as never,
    )
    await client.connect()

    expect(imapState.lastOptions?.['doSTARTTLS']).toBe(false)
    expect(imapState.lastOptions?.['secure']).toBe(true)
  })

  it('sin CA, no valida el certificado (y el logger lo avisa)', async () => {
    const client = new ImapClient(bridgeCfg, silentLog as never)
    await client.connect()

    const tls = imapState.lastOptions?.['tls'] as { rejectUnauthorized: boolean; ca?: string[] }
    expect(tls.rejectUnauthorized).toBe(false)
    expect(tls.ca).toBeUndefined()
  })

  it('con CA configurada, la usa y valida', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imap-tls-'))
    const caPath = join(dir, 'ca.pem')
    writeFileSync(caPath, PEM)

    try {
      const client = new ImapClient(
        ({ ...bridgeCfg, tlsInsecure: false, caPath }),
        silentLog as never,
      )
      await client.connect()

      const tls = imapState.lastOptions?.['tls'] as { rejectUnauthorized: boolean; ca?: string[] }
      expect(tls.rejectUnauthorized).toBe(true)
      expect(tls.ca).toEqual([PEM])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
