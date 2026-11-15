/**
 * Tests unitarios para src/server/suite.ts (16.93% cobertura).
 *
 * registerSuiteTool registra la MCP tool 'proton_suite_status' que
 * consolida el estado de todos los productos Proton Suite.
 *
 * Estrategia de mocks:
 *  - diagnoseMail (import dinámico en src/diagnostics.js) → vi.mock
 *  - PassClient (new PassClient + health() en src/pass.js) → vi.mock
 *  - ImapClient / DriveClient → pasados como dependencias al closure
 *  - McpServer.registerTool → capturamos el handler para invocarlo directo
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config } from '../../src/config.js'
import type { DriveClient } from '../../src/drive.js'
import type { ImapClient } from '../../src/imap.js'
import { registerSuiteTool } from '../../src/server/suite.js'

// ---------------------------------------------------------------------------
// Shared state via vi.hoisted() — se ejecuta antes que vi.mock factories
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const mockDiagnoseMail = vi.fn()
  const mockPassHealth = vi.fn()

  return {
    mockDiagnoseMail,
    mockPassHealth,
  }
})

// ---------------------------------------------------------------------------
// vi.mock — módulos importados dinámicamente por registerSuiteTool
// ---------------------------------------------------------------------------

vi.mock('../../src/diagnostics.js', () => ({
  diagnoseMail: hoisted.mockDiagnoseMail,
}))

vi.mock('../../src/pass.js', () => {
  const MockPassClient = vi.fn()
  // @ts-expect-error — constructor devuelve objeto mockeado, no clase real
  MockPassClient.mockImplementation(() => ({
    health: hoisted.mockPassHealth,
  }))
  return { createPassClient: MockPassClient }
})

// ---------------------------------------------------------------------------
// Helpers de test
// ---------------------------------------------------------------------------

/** Logger silencioso compatible con ReturnType<typeof createLogger> */
const silentLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

/** Crea una Config mínima con productos toggleables */
function makeConfig(overrides?: Partial<Config>): Config {
  return {
    products: {
      mail: { enabled: false, bridge: { host: '127.0.0.1', imapPort: 1143, smtpPort: 1025, user: 'test@example.com', pass: 'test', tlsInsecure: true } },
      pass: { enabled: false, storeDir: '/tmp/pass-store' },
      calendar: { enabled: false },
      drive: { enabled: false, cliBin: '/usr/bin/proton-drive', stagingDir: '/tmp/drive-stage', obsoleteExtensions: [] },
    },
    transport: { kind: 'stdio', httpHost: '127.0.0.1', httpPort: 8787, allowedOrigins: [] },
    alerts: { minSeverity: 'warning', logDir: 'logs', enabled: true },
    agent: { dryRun: true, maxInspectEmails: 1000, minConfidence: 0.6 },
    logLevel: 'info',
    ...overrides,
  }
}

/** Crea un McpServer mockeado que captura el handler registrado */
function captureHandler() {
  let capturedHandler: ((args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>) | null = null
  const server = {
    registerTool: vi.fn((_name: string, _schema: unknown, handler: typeof capturedHandler) => {
      capturedHandler = handler
    }),
  } as unknown as McpServer
  return { server, invoke: async () => capturedHandler!({}) }
}

/** Crea un ImapClient mockeado */
function makeImap(overrides?: Partial<ImapClient>): ImapClient {
  return {
    listMailboxes: vi.fn().mockResolvedValue([{ path: 'INBOX', name: 'INBOX', delimiter: '/', flags: [], specialUse: '\\Inbox', subscribed: true, listed: true }]),
    mailboxStatus: vi.fn().mockResolvedValue({ messages: 42, unseen: 3, recent: 0, uidNext: 100 }),
    ...overrides,
  } as unknown as ImapClient
}

/** Crea un DriveClient mockeado */
function makeDriveClient(overrides?: Partial<DriveClient>): DriveClient {
  return {
    checkDeps: vi.fn().mockReturnValue({ ok: true, version: '1.0.0' }),
    ...overrides,
  } as unknown as DriveClient
}

/** Bridge config mínimo */
const defaultBridgeCfg = {
  host: '127.0.0.1',
  imapPort: 1143,
  smtpPort: 1025,
  user: 'test@example.com',
  pass: 'test',
  tlsInsecure: true,
}

const passwordResolver = vi.fn().mockResolvedValue('test')

// ---------------------------------------------------------------------------
// Reseteo entre tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerSuiteTool · proton_suite_status', () => {
  // -----------------------------------------------------------------------
  // Todos los productos deshabilitados
  // -----------------------------------------------------------------------

  it('devuelve todos unavailable cuando todos los productos están disabled', async () => {
    const imap = makeImap()
    const cfg = makeConfig()
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg,
      log: silentLog,
      imap,
      driveClient: undefined,
      passwordResolver,
      bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.mail.available).toBe(false)
    expect(json.mail.error).toBe('not_configured')
    expect(json.pass.available).toBe(false)
    expect(json.pass.error).toBe('not_configured')
    expect(json.calendar.available).toBe(false)
    expect(json.calendar.reason).toBeUndefined()
    expect(json.drive.available).toBe(false)
    expect(json.drive.reason).toContain('DRIVE_ENABLED')
    // diagnoseMail no debe llamarse
    expect(hoisted.mockDiagnoseMail).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Mail enabled — varios escenarios
  // -----------------------------------------------------------------------

  it('mail: disponible y conectado cuando diagnóstico + IMAP funcionan', async () => {
    hoisted.mockDiagnoseMail.mockResolvedValue({
      tcp: { reachable: true, latencyMs: 5 },
      imapHandshake: { ok: true, capabilities: ['IMAP4rev1'], greeting: 'OK' },
      auth: { ok: true },
      folders: { count: 5, accessible: true },
    })
    const imap = makeImap()
    const cfg = makeConfig({ products: { mail: { enabled: true, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg,
      log: silentLog,
      imap,
      driveClient: undefined,
      passwordResolver,
      bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.mail.available).toBe(true)
    expect(json.mail.connected).toBe(true)
    expect(json.mail.mailboxes).toBeGreaterThan(0)
    expect(json.mail.unread).toBe(3)
    expect(json.mail.error).toBeUndefined()
    expect(json.mail.diagnostics).toBeDefined()
    expect(json.mail.diagnostics.tcp.reachable).toBe(true)
    expect(hoisted.mockDiagnoseMail).toHaveBeenCalledTimes(1)
    expect((imap as { listMailboxes: ReturnType<typeof vi.fn> }).listMailboxes).toHaveBeenCalled()
    expect((imap as { mailboxStatus: ReturnType<typeof vi.fn> }).mailboxStatus).toHaveBeenCalledWith('INBOX')
  })

  it('mail: conectado=false cuando auth falla en diagnóstico', async () => {
    hoisted.mockDiagnoseMail.mockResolvedValue({
      tcp: { reachable: true, latencyMs: 5 },
      imapHandshake: { ok: true, capabilities: ['IMAP4rev1'], greeting: 'OK' },
      auth: { ok: false, error: 'Invalid credentials' },
    })
    const imap = makeImap()
    const cfg = makeConfig({ products: { mail: { enabled: true, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap, driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.mail.available).toBe(true)
    expect(json.mail.connected).toBe(false)
    expect(json.mail.error).toBe('Invalid credentials')
    // Sin IMAP calls porque auth falló
    expect((imap as { listMailboxes: ReturnType<typeof vi.fn> }).listMailboxes).not.toHaveBeenCalled()
  })

  it('mail: captura error cuando diagnoseMail lanza excepción', async () => {
    hoisted.mockDiagnoseMail.mockRejectedValue(new Error('Connection refused'))
    const cfg = makeConfig({ products: { mail: { enabled: true, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: { health: hoisted.mockPassHealth },
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.mail.available).toBe(false)
    expect(json.mail.connected).toBe(false)
    expect(json.mail.error).toContain('Connection refused')
  })

  it('mail: usa fallback de mailboxes cuando listMailboxes lanza error', async () => {
    hoisted.mockDiagnoseMail.mockResolvedValue({
      tcp: { reachable: true, latencyMs: 5 },
      imapHandshake: { ok: true, capabilities: ['IMAP4rev1'], greeting: 'OK' },
      auth: { ok: true },
      folders: { count: 5, accessible: true },
    })
    const imap = makeImap({
      listMailboxes: vi.fn().mockRejectedValue(new Error('IMAP error')),
    })
    const cfg = makeConfig({ products: { mail: { enabled: true, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap, driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.mail.available).toBe(true)
    expect(json.mail.connected).toBe(true)
    // Fallback al count de diagnoseMail.folders (5)
    expect(json.mail.mailboxes).toBe(5)
    expect(json.mail.unread).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Pass enabled — varios escenarios
  // -----------------------------------------------------------------------

  it('pass: disponible y conectado cuando health() ok', async () => {
    hoisted.mockPassHealth.mockResolvedValue({ ok: true, entries: 15 })
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: true, storeDir: '/tmp/pass-store' }, calendar: { enabled: false }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: { health: hoisted.mockPassHealth },
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.pass.available).toBe(true)
    expect(json.pass.connected).toBe(true)
    expect(json.pass.entries).toBe(15)
    expect(json.pass.error).toBeUndefined()
  })

  it('pass: conectado=false cuando health() devuelve error', async () => {
    hoisted.mockPassHealth.mockResolvedValue({ ok: false, entries: 0, error: 'Store not accessible' })
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: true, storeDir: '/tmp/pass-store' }, calendar: { enabled: false }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: { health: hoisted.mockPassHealth },
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.pass.available).toBe(true)
    expect(json.pass.connected).toBe(false)
    expect(json.pass.error).toBe('Store not accessible')
  })

  it('pass: captura error cuando PassClient lanza excepción', async () => {
    hoisted.mockPassHealth.mockRejectedValue(new Error('Disk full'))
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: true, storeDir: '/tmp/pass-store' }, calendar: { enabled: false }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: { health: hoisted.mockPassHealth },
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.pass.available).toBe(false)
    expect(json.pass.connected).toBe(false)
    expect(json.pass.error).toContain('Disk full')
  })

  // -----------------------------------------------------------------------
  // Calendar enabled
  // -----------------------------------------------------------------------

  it('calendar: devuelve unavailable con razón CalDAV cuando está enabled', async () => {
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: true }, drive: { enabled: false, cliBin: '', stagingDir: '', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.calendar.available).toBe(false)
    expect(json.calendar.reason).toContain('CalDAV')
  })

  it('calendar: sin reason cuando está disabled', async () => {
    const cfg = makeConfig()
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.calendar.available).toBe(false)
    expect(json.calendar.reason).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Drive enabled — varios escenarios
  // -----------------------------------------------------------------------

  it('drive: disponible cuando enabled + client + checkDeps ok', async () => {
    const driveClient = makeDriveClient({ checkDeps: vi.fn().mockReturnValue({ ok: true, version: '2.4.0' }) })
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: true, cliBin: '/usr/bin/proton-drive', stagingDir: '/tmp/drive-stage', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap: makeImap(), driveClient, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.drive.available).toBe(true)
    expect(json.drive.cliPath).toBe('/usr/bin/proton-drive')
    expect(json.drive.stagingDir).toBe('/tmp/drive-stage')
    expect(json.drive.error).toBeUndefined()
  })

  it('drive: no disponible cuando checkDeps falla', async () => {
    const driveClient = makeDriveClient({ checkDeps: vi.fn().mockReturnValue({ ok: false, error: 'proton-drive not found: ENOENT' }) })
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: true, cliBin: '/no-existe/proton-drive', stagingDir: '/tmp/drive-stage', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap: makeImap(), driveClient, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.drive.available).toBe(false)
    expect(json.drive.error).toContain('ENOENT')
  })

  it('drive: no disponible cuando driveClient es undefined', async () => {
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: true, cliBin: '/usr/bin/proton-drive', stagingDir: '/tmp/drive-stage', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.drive.available).toBe(false)
    expect(json.drive.reason).toContain('DRIVE_ENABLED')
  })

  it('drive: captura error cuando checkDeps lanza excepción', async () => {
    const driveClient = makeDriveClient({ checkDeps: vi.fn().mockImplementation(() => { throw new Error('checkDeps crashed') }) })
    const cfg = makeConfig({ products: { mail: { enabled: false, bridge: defaultBridgeCfg }, pass: { enabled: false, storeDir: '' }, calendar: { enabled: false }, drive: { enabled: true, cliBin: '/usr/bin/proton-drive', stagingDir: '/tmp/drive-stage', obsoleteExtensions: [] } } })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap: makeImap(), driveClient, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    expect(json.drive.available).toBe(false)
    expect(json.drive.error).toContain('checkDeps crashed')
  })

  // -----------------------------------------------------------------------
  // Combinaciones — todos enabled
  // -----------------------------------------------------------------------

  it('todos los productos enabled reportan sus estados correctamente', async () => {
    hoisted.mockDiagnoseMail.mockResolvedValue({
      tcp: { reachable: true, latencyMs: 3 },
      imapHandshake: { ok: true, capabilities: ['IMAP4rev1'], greeting: 'OK' },
      auth: { ok: true },
      folders: { count: 8, accessible: true },
    })
    hoisted.mockPassHealth.mockResolvedValue({ ok: true, entries: 22 })
    const driveClient = makeDriveClient({ checkDeps: vi.fn().mockReturnValue({ ok: true, version: '1.0.0' }) })
    const imap = makeImap()
    const cfg = makeConfig({
      products: {
        mail: { enabled: true, bridge: defaultBridgeCfg },
        pass: { enabled: true, storeDir: '/tmp/pass-store' },
        calendar: { enabled: true },
        drive: { enabled: true, cliBin: '/usr/bin/proton-drive', stagingDir: '/tmp/drive-stage', obsoleteExtensions: [] },
      },
    })
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: { health: hoisted.mockPassHealth },
      cfg, log: silentLog, imap, driveClient, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()
    const json = JSON.parse(result.content[0].text)

    // Mail
    expect(json.mail.available).toBe(true)
    expect(json.mail.connected).toBe(true)
    expect(json.mail.mailboxes).toBeGreaterThan(0)
    // Pass
    expect(json.pass.available).toBe(true)
    expect(json.pass.connected).toBe(true)
    expect(json.pass.entries).toBe(22)
    // Calendar
    expect(json.calendar.available).toBe(false)
    expect(json.calendar.reason).toContain('CalDAV')
    // Drive
    expect(json.drive.available).toBe(true)
    expect(json.drive.cliPath).toBe('/usr/bin/proton-drive')
    expect(json.drive.stagingDir).toBe('/tmp/drive-stage')
  })

  // -----------------------------------------------------------------------
  // Output format
  // -----------------------------------------------------------------------

  it('devuelve content[0].text como JSON stringify con indent 2', async () => {
    const cfg = makeConfig()
    const { server, invoke } = captureHandler()

    registerSuiteTool(server, {
      passClient: undefined,
      cfg, log: silentLog, imap: makeImap(), driveClient: undefined, passwordResolver, bridgeCfg: defaultBridgeCfg,
    })

    const result = await invoke()

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    // Verificar que es JSON válido con indentación
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toBeDefined()
    expect(result.content[0].text).toContain('\n') // multiline
  })
})
