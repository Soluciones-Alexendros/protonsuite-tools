/**
 * Cobertura de las 14 tools `proton_*` registradas en `buildServer`.
 *
 * Estrategia: `imapflow`, `nodemailer` y `mailparser` se MOCKEAN con `vi.mock`,
 * así no hay red real contra Bridge. Levantamos un `McpServer` real vía
 * `buildServer` y un `Client` del SDK conectados por `InMemoryTransport`.
 * Llamar a las tools por el cliente ejercita la validación Zod del
 * `inputSchema` (un input válido y uno inválido por tool) y el happy-path con
 * el mock devolviendo datos.
 *
 * Nota sobre validación: el SDK MCP NO lanza ante `arguments` inválidos —
 * devuelve un resultado con `isError: true` y un texto "Input validation
 * error" (JSON-RPC -32602). Por eso los casos inválidos se asertan vía
 * `expectValidationError`, no con `.rejects`.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  beforeAll,
  afterAll,
} from 'vitest'
import type { Config } from '../src/config.js'
import { DriveClient, type DriveConfig } from '../src/drive.js'
import { buildServer } from '../src/server.js'

// -----------------------------------------------------------------------------
// Mock state, mutable per-test
// -----------------------------------------------------------------------------
const imapState = {
  listResult: [] as unknown[],
  statusResult: {} as Record<string, unknown>,
  fetchResults: [] as unknown[],
  fetchOneResult: null as unknown,
  searchResult: [] as number[],
  mailboxCreateResult: { path: 'X', created: true },
  moveResult: true,
  deleteResult: true,
  flagsAddResult: true,
  flagsRemoveResult: true,
}

const sendMailMock = vi.fn().mockResolvedValue({
  messageId: '<generated@local>',
  accepted: ['bob@example.com'],
  rejected: [],
  response: '250 OK',
})

vi.mock('imapflow', () => {
  class ImapFlow {
    usable = true
    on() {}
    connect() {}
    logout() {}
    list() {
      return imapState.listResult
    }
    mailboxCreate() {
      return imapState.mailboxCreateResult
    }
    status() {
      return imapState.statusResult
    }
    getMailboxLock() {
      return { release() {} }
    }
    *fetch() {
      yield* imapState.fetchResults
    }
    fetchOne() {
      return imapState.fetchOneResult
    }
    search() {
      return imapState.searchResult
    }
    messageMove() {
      return imapState.moveResult
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
      return { uid: 1 }
    }
  }
  return { ImapFlow }
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: sendMailMock,
      close() {},
    }),
  },
}))

// mailparser stub: source Buffer is irrelevant, we return a fixed parsed mail.
vi.mock('mailparser', () => ({
  simpleParser: () => ({
    headers: new Map<string, string>([['references', '']]),
    cc: undefined,
    bcc: undefined,
    replyTo: undefined,
    text: 'Hello body',
    html: '<p>Hello body</p>',
    attachments: [
      {
        filename: 'a.txt',
        contentType: 'text/plain',
        size: 5,
        content: Buffer.from('hello'),
        contentId: undefined,
        checksum: undefined,
      },
    ],
  }),
}))

const cfg: Config = {
  products: {
    mail: {
      enabled: true,
      bridge: {
        user: 'me@proton.me',
        pass: 'x',
        host: '127.0.0.1',
        imapPort: 1143,
        smtpPort: 1025,
        from: 'me@proton.me',
        tlsInsecure: true,
        smtpSecurity: 'starttls' as const,
      },
    },
    pass: { enabled: false, storeDir: '/tmp' },
    calendar: { enabled: false },
    drive: {
      enabled: false,
      cliBin: 'proton-drive',
      stagingDir: '/tmp/test-drive-default',
      obsoleteExtensions: [],
    },
  },
  transport: {
    kind: 'stdio',
    httpHost: '127.0.0.1',
    httpPort: 8787,
    allowedOrigins: [],
  },
  alerts: {
    enabled: false,
    logDir: 'logs',
    minSeverity: 'warning',
  },
  agent: {
    dryRun: true,
    maxInspectEmails: 10,
    minConfidence: 0.6,
  },
  // Política declarada a propósito para este fichero: estas pruebas comprueban
  // el comportamiento de las herramientas, NO la autorización. Autorizar todas
  // las clases aquí es explícito; el control se prueba en tests/authz y en el
  // test de extremo a extremo de autorización.
  authz: {
    mode: 'enforce',
    actor: 'test',
    approvalDir: '/tmp/test-authz-approvals',
    journalFile: '/tmp/test-authz-journal.jsonl',
    allow: ['read', 'write', 'destructive', 'admin'],
    requireApproval: [],
  },
  logLevel: 'error',
}

const silentLog = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}

async function makeClient() {
  const { server } = buildServer(cfg, silentLog)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverT), client.connect(clientT)])
  return client
}

function firstText(res: { content: unknown }): string {
  return (res.content as { text: string }[])[0].text
}

/** Asserts the SDK returned a Zod input-validation error (isError + -32602 text). */
async function expectValidationError(
  name: string,
  args: Record<string, unknown>,
) {
  const client = await makeClient()
  const res = await client.callTool({ name, arguments: args })
  expect(res.isError).toBe(true)
  expect(firstText(res)).toMatch(/validation error/i)
}

// A summary message as imapflow's fetch yields it (envelope + flags + size).
const summaryMsg = {
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
}

beforeEach(() => {
  sendMailMock.mockClear()
  imapState.listResult = [
    {
      path: 'INBOX',
      name: 'INBOX',
      delimiter: '/',
      flags: new Set(),
      specialUse: '\\Inbox',
      subscribed: true,
      listed: true,
    },
    {
      path: 'Trash',
      name: 'Trash',
      delimiter: '/',
      flags: new Set(),
      specialUse: '\\Trash',
      subscribed: true,
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
  imapState.fetchResults = [summaryMsg]
  imapState.fetchOneResult = {
    uid: 42,
    seq: 1,
    source: Buffer.from('raw'),
    flags: new Set(['\\Seen']),
    size: 1234,
    envelope: summaryMsg.envelope,
  }
  imapState.searchResult = [42]
  imapState.moveResult = true
  imapState.deleteResult = true
  imapState.flagsAddResult = true
  imapState.flagsRemoveResult = true
})

// -----------------------------------------------------------------------------
describe('buildServer · tool registration', () => {
  it('exposes exactly 25 proton_* tools', async () => {
    const client = await makeClient()
    const { tools } = await client.listTools()
    expect(tools.filter((t) => t.name.startsWith('proton_'))).toHaveLength(25)
  })
})

// -----------------------------------------------------------------------------
// Folders
// -----------------------------------------------------------------------------
describe('proton_list_folders', () => {
  it('happy path returns folders in structuredContent', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_list_folders',
      arguments: { response_format: 'json' },
    })
    const sc = res.structuredContent as { folders: { path: string }[] }
    expect(sc.folders.map((f) => f.path)).toEqual(['INBOX', 'Trash'])
  })

  it('rejects invalid response_format (Zod enum)', async () => {
    await expectValidationError('proton_list_folders', {
      response_format: 'xml',
    })
  })
})

describe('proton_create_folder', () => {
  it('happy path creates a mailbox', async () => {
    imapState.mailboxCreateResult = { path: 'Projects/X', created: true }
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_create_folder',
      arguments: { path: 'Projects/X' },
    })
    expect(firstText(res)).toContain('Created Projects/X')
  })

  it('rejects empty path (min(1))', async () => {
    await expectValidationError('proton_create_folder', { path: '' })
  })
})

describe('proton_mailbox_status', () => {
  it('happy path returns counts', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_mailbox_status',
      arguments: { mailbox: 'INBOX' },
    })
    const sc = res.structuredContent as { messages: number; unseen: number }
    expect(sc.messages).toBe(10)
    expect(sc.unseen).toBe(3)
  })

  it('rejects non-string mailbox', async () => {
    await expectValidationError('proton_mailbox_status', { mailbox: 123 })
  })
})

// -----------------------------------------------------------------------------
// Listing / search
// -----------------------------------------------------------------------------
describe('proton_list_emails', () => {
  it('happy path lists emails with pagination metadata', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_list_emails',
      arguments: {
        mailbox: 'INBOX',
        limit: 25,
        offset: 0,
        response_format: 'json',
      },
    })
    const sc = res.structuredContent as {
      total: number
      items: { uid: number }[]
    }
    expect(sc.total).toBe(10)
    expect(sc.items[0].uid).toBe(42)
  })

  it('rejects limit above max (100)', async () => {
    await expectValidationError('proton_list_emails', { limit: 999 })
  })
})

describe('proton_search_emails', () => {
  it('happy path returns matched messages', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_search_emails',
      arguments: {
        mailbox: 'INBOX',
        query: 'hi',
        fields: ['text'],
        response_format: 'json',
      },
    })
    const sc = res.structuredContent as {
      matched: number
      items: { uid: number }[]
    }
    expect(sc.matched).toBe(1)
    expect(sc.items[0].uid).toBe(42)
  })

  it('rejects unknown field in fields enum', async () => {
    await expectValidationError('proton_search_emails', { fields: ['nope'] })
  })

  it("rejects a malformed ISO date in 'since' (Zod refine, not a cryptic IMAP error)", async () => {
    await expectValidationError('proton_search_emails', { since: '2026-99-99' })
  })
})

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------
describe('proton_get_email', () => {
  it('happy path returns the full email body', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_get_email',
      arguments: { mailbox: 'INBOX', uid: 42, response_format: 'json' },
    })
    const sc = res.structuredContent as { uid: number; textBody: string }
    expect(sc.uid).toBe(42)
    expect(sc.textBody).toBe('Hello body')
  })

  it('rejects non-positive uid', async () => {
    await expectValidationError('proton_get_email', { uid: 0 })
  })
})

describe('proton_get_attachment', () => {
  it('happy path returns base64 bytes', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_get_attachment',
      arguments: { mailbox: 'INBOX', uid: 42, index: 0 },
    })
    const sc = res.structuredContent as {
      filename: string
      base64: string
      truncated: boolean
    }
    expect(sc.filename).toBe('a.txt')
    expect(Buffer.from(sc.base64, 'base64').toString()).toBe('hello')
    expect(sc.truncated).toBe(false)
  })

  it('rejects negative index', async () => {
    await expectValidationError('proton_get_attachment', {
      uid: 42,
      index: -1,
    })
  })
})

// -----------------------------------------------------------------------------
// Send / reply / forward
// -----------------------------------------------------------------------------
describe('proton_send_email', () => {
  it('happy path sends and reports messageId', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_send_email',
      arguments: { to: ['bob@example.com'], subject: 'Hi', text: 'Body' },
    })
    expect(sendMailMock).toHaveBeenCalledOnce()
    expect(firstText(res)).toContain('messageId=')
  })

  it('rejects invalid recipient email', async () => {
    await expectValidationError('proton_send_email', {
      to: ['not-an-email'],
      subject: 'Hi',
      text: 'B',
    })
  })

  it('returns isError when neither text nor html provided', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_send_email',
      arguments: { to: ['bob@example.com'], subject: 'Hi' },
    })
    expect(res.isError).toBe(true)
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})

describe('proton_reply_email', () => {
  it('happy path replies preserving thread', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_reply_email',
      arguments: { mailbox: 'INBOX', uid: 42, text: 'Thanks' },
    })
    expect(sendMailMock).toHaveBeenCalledOnce()
    expect(firstText(res)).toContain('Reply sent to')
  })

  it('rejects non-integer uid', async () => {
    await expectValidationError('proton_reply_email', { uid: 1.5, text: 'x' })
  })
})

describe('proton_forward_email', () => {
  it('happy path forwards to new recipients', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_forward_email',
      arguments: {
        mailbox: 'INBOX',
        uid: 42,
        to: ['carol@example.com'],
        include_attachments: false,
      },
    })
    expect(sendMailMock).toHaveBeenCalledOnce()
    expect(firstText(res)).toContain('Forwarded to carol@example.com')
  })

  it("rejects empty 'to' array (min 1)", async () => {
    await expectValidationError('proton_forward_email', { uid: 42, to: [] })
  })
})

// -----------------------------------------------------------------------------
// Modify
// -----------------------------------------------------------------------------
describe('proton_flag_email', () => {
  it('happy path marks as read', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_flag_email',
      arguments: { mailbox: 'INBOX', uid: 42, action: 'read' },
    })
    expect(firstText(res)).toContain('Flags updated on UID 42')
  })

  it('rejects unknown action', async () => {
    await expectValidationError('proton_flag_email', {
      uid: 42,
      action: 'burn',
    })
  })
})

describe('proton_move_email', () => {
  it('happy path moves message', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_move_email',
      arguments: { from_mailbox: 'INBOX', uid: 42, to_mailbox: 'Trash' },
    })
    expect(firstText(res)).toContain('Moved UID 42 → Trash')
  })

  it('rejects missing from_mailbox (required string)', async () => {
    await expectValidationError('proton_move_email', {
      uid: 42,
      to_mailbox: 'Trash',
    })
  })
})

describe('proton_delete_email', () => {
  it('happy path trash mode moves to Trash', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_delete_email',
      arguments: {
        mailbox: 'INBOX',
        uid: 42,
        mode: 'trash',
        trash_path: 'Trash',
      },
    })
    expect(firstText(res)).toContain('Moved UID 42 to Trash')
  })

  it('trash mode auto-detects the \\Trash mailbox when trash_path is omitted', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_delete_email',
      arguments: { mailbox: 'INBOX', uid: 42, mode: 'trash' },
    })
    expect(firstText(res)).toContain('Moved UID 42 to Trash')
  })

  it('trash mode resolves a non-English Trash (Papelera) via \\Trash special-use', async () => {
    imapState.listResult = [
      {
        path: 'INBOX',
        name: 'INBOX',
        delimiter: '/',
        flags: new Set(),
        specialUse: '\\Inbox',
        subscribed: true,
        listed: true,
      },
      {
        path: 'Papelera',
        name: 'Papelera',
        delimiter: '/',
        flags: new Set(),
        specialUse: '\\Trash',
        subscribed: true,
        listed: true,
      },
    ]
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_delete_email',
      arguments: { mailbox: 'INBOX', uid: 42, mode: 'trash' },
    })
    expect(firstText(res)).toContain('Moved UID 42 to Papelera')
  })

  it('happy path permanent mode expunges', async () => {
    const client = await makeClient()
    const res = await client.callTool({
      name: 'proton_delete_email',
      arguments: { mailbox: 'INBOX', uid: 42, mode: 'permanent' },
    })
    expect(firstText(res)).toContain('Permanently deleted UID 42')
  })

  it('rejects invalid mode enum', async () => {
    await expectValidationError('proton_delete_email', {
      uid: 42,
      mode: 'shred',
    })
  })
})

describe('drive tools', () => {
  it('should create DriveClient with config', () => {
    const cfg: DriveConfig = {
      cliBin: 'proton-drive',
      stagingDir: '/tmp/test-drive',
      obsoleteExtensions: ['.doc'],
    }
    const dc = new DriveClient(cfg, {
      debug: () => {},
      info: () => {},
      error: () => {},
    })
    expect(dc.stagingDir).toBe('/tmp/test-drive')
  })

  it('should return status without errors', async () => {
    const cfg: DriveConfig = {
      cliBin: 'proton-drive',
      stagingDir: '/tmp/test-status',
      obsoleteExtensions: [],
    }
    const dc = new DriveClient(cfg, {
      debug: () => {},
      info: () => {},
      error: () => {},
    })
    const st = await dc.status()
    expect(st.configured).toBe(true)
    expect(st.cliPath).toBe('proton-drive')
    expect(typeof st.authenticated).toBe('boolean')
  })
})

describe('drive tools (registered)', () => {
  const driveCfg: Config = {
    ...cfg,
    products: {
      ...cfg.products,
      drive: {
        enabled: true,
        cliBin: 'proton-drive',
        stagingDir: '/tmp/test-drive-registered',
        obsoleteExtensions: ['.doc', '.ppt', '.xls', '.bmp'],
      },
    },
  }

  it('registers the 14 drive tools', async () => {
    const { server } = buildServer(driveCfg, silentLog)
    const client = new Client({ name: 'test', version: '1.0.0' })
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverT), client.connect(clientT)])
    const { tools } = await client.listTools()
    const driveTools = tools.filter((t) => t.name.startsWith('proton_drive_'))
    expect(driveTools).toHaveLength(14)
    await client.close()
  })

  it('proton_drive_status returns structured content without throwing', async () => {
    const { server } = buildServer(driveCfg, silentLog)
    const client = new Client({ name: 'test', version: '1.0.0' })
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverT), client.connect(clientT)])
    const res = await client.callTool({
      name: 'proton_drive_status',
      arguments: { response_format: 'json' },
    })
    expect(res.isError).not.toBe(true)
    const sc = res.structuredContent as {
      configured: boolean
      cliPath: string
      authenticated: boolean
    }
    expect(sc.configured).toBe(true)
    expect(sc.cliPath).toBe('proton-drive')
    await client.close()
  })

  // Temp staging dir exercised end-to-end by the handler tests below.
  let stagingDir: string
  beforeAll(() => {
    stagingDir = mkdtempSync(join(tmpdir(), 'test-drive-handlers-'))
    writeFileSync(join(stagingDir, 'README.md'), '# hi\n')
    writeFileSync(join(stagingDir, 'notes.txt'), 'notes\n')
  })
  afterAll(() => {
    rmSync(stagingDir, { recursive: true, force: true })
  })

  async function makeDriveClient() {
    // La raíz del workspace es el directorio temporal: así el `staging_dir` que
    // manda el cliente cae DENTRO y el sandbox lo acepta (F05).
    const cfgConStaging = {
      ...driveCfg,
      products: {
        ...driveCfg.products,
        drive: { ...driveCfg.products.drive, stagingDir },
      },
    }
    const { server } = buildServer(cfgConStaging, silentLog)
    const client = new Client({ name: 'test', version: '1.0.0' })
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverT), client.connect(clientT)])
    return client
  }

  it('proton_drive_audit returns inventory over staging_dir', async () => {
    const client = await makeDriveClient()
    const res = await client.callTool({
      name: 'proton_drive_audit',
      arguments: { response_format: 'json', staging_dir: stagingDir },
    })
    expect(res.isError).not.toBe(true)
    const sc = res.structuredContent as { totalFiles: number }
    expect(sc.totalFiles).toBeGreaterThanOrEqual(1)
    await client.close()
  })

  it('RECHAZA un staging_dir fuera del workspace (F05)', async () => {
    const client = await makeDriveClient()
    const res = await client.callTool({
      name: 'proton_drive_audit',
      arguments: { response_format: 'json', staging_dir: '/etc' },
    })

    expect(res.isError).toBe(true)
    expect((res.content as { text: string }[])[0]!.text).toContain('Ruta rechazada')
    await client.close()
  })

  it('proton_drive_format_report returns extensions over staging_dir', async () => {
    const client = await makeDriveClient()
    const res = await client.callTool({
      name: 'proton_drive_format_report',
      arguments: { response_format: 'json', staging_dir: stagingDir },
    })
    expect(res.isError).not.toBe(true)
    const sc = res.structuredContent as { extensions: unknown[] }
    expect(Array.isArray(sc.extensions)).toBe(true)
    await client.close()
  })

  it('proton_drive_organize dry-run returns a plan without moving', async () => {
    const client = await makeDriveClient()
    const res = await client.callTool({
      name: 'proton_drive_organize',
      arguments: { dry_run: true, staging_dir: stagingDir },
    })
    expect(res.isError).not.toBe(true)
    await client.close()
  })

  // NOTE: proton_drive_upload/share/download son herramientas nuevas del CLI
  // oficial — ver docs/drive-audit.md. Estas herramientas invocan el binario
  // externo y se prueban e2e contra un Drive real (no mockeable en CI).
})
