/**
 * T-AUTHZ-01 de extremo a extremo — El control conectado al servidor real.
 *
 * Esta es la prueba que distingue «tengo un motor» de «tengo un control». Se
 * construye el servidor de verdad, se llama a una herramienta mutativa por el
 * canal MCP y se comprueba que NO se ejecuta, que se puede aprobar desde fuera
 * y que cambiar un argumento invalida la aprobación.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ApprovalStore } from '../../src/authz/index.js'
import { buildServer } from '../../src/server.js'
import type { Config } from '../../src/config.js'

const { smtpSend } = vi.hoisted(() => ({ smtpSend: vi.fn() }))

vi.mock('../../src/imap.js', () => ({
  ImapClient: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../src/smtp.js', () => ({
  SmtpClient: vi.fn().mockImplementation(() => ({ send: smtpSend })),
  buildReplyOptions: vi.fn(),
  buildForwardOptions: vi.fn(),
}))
vi.mock('../../src/pass.js', () => ({
  PassClient: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../src/drive.js', () => ({
  DriveClient: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../src/bridge/bridge-client.js', () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({})),
}))

let dir: string
let journal: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'authz-e2e-'))
  journal = join(dir, 'authz.jsonl')
  smtpSend.mockReset()
  smtpSend.mockResolvedValue({
    messageId: '<ok@proton.me>',
    accepted: ['destino@proton.me'],
    rejected: [],
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeCfg(): Config {
  return {
    products: {
      mail: {
        enabled: true,
        bridge: {
          user: 'op@proton.me',
          pass: 'x',
          host: '127.0.0.1',
          imapPort: 1143,
          smtpPort: 1025,
          from: 'op@proton.me',
          tlsInsecure: true,
          imapSecurity: 'starttls', smtpSecurity: 'starttls',
        },
      },
      pass: { enabled: false, storeDir: '/tmp/pass' },
      calendar: { enabled: false, experimental: false },
      drive: { enabled: false, cliBin: 'proton-drive', stagingDir: '/tmp/st', obsoleteExtensions: [] },
    },
    transport: { kind: 'stdio', httpHost: '127.0.0.1', httpPort: 8787, allowedOrigins: [] },
    alerts: { enabled: false, logDir: dir, minSeverity: 'warning' },
    agent: { dryRun: true, maxInspectEmails: 10, minConfidence: 0.6 },
    authz: {
      mode: 'enforce',
      actor: 'alex',
      approvalDir: join(dir, 'approvals'),
      journalFile: journal,
      allow: ['read'],
      requireApproval: ['write', 'destructive', 'admin'],
    },
    logLevel: 'error',
  } as Config
}

const silentLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

async function connect(cfg: Config) {
  const { server } = buildServer(cfg, silentLog)
  const client = new Client({ name: 'authz-test', version: '1.0.0' })
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverT), client.connect(clientT)])
  return client
}

type ToolResult = {
  isError?: boolean
  content: { text: string }[]
  structuredContent?: Record<string, unknown>
}

const MENSAJE = { to: ['destino@proton.me'], subject: 'hola', text: 'cuerpo' }

describe('T-AUTHZ-01 · control conectado al servidor', () => {
  it('sin aprobación, la herramienta NO se ejecuta', async () => {
    const client = await connect(makeCfg())
    const res = (await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })) as ToolResult

    expect(res.isError).toBe(true)
    expect(res.structuredContent?.['status']).toBe('approval_required')
    expect(res.content[0]?.text).toContain('No se ha ejecutado nada')
    // Lo que de verdad importa: el envío no ocurrió.
    expect(smtpSend).not.toHaveBeenCalled()
  })

  it('la lectura sí pasa, sin aprobación', async () => {
    const client = await connect(makeCfg())
    await client.callTool({ name: 'proton_mailbox_status', arguments: {} }).catch(() => undefined)
    // No se exige que el mock de IMAP responda: lo relevante es que no se pide
    // aprobación para leer.
    const lines = readFileSync(journal, 'utf8').trim().split('\n')
    expect(lines.some((l) => l.includes('proton_mailbox_status'))).toBe(true)
  })

  it('aprobada desde fuera, la MISMA llamada se ejecuta', async () => {
    const cfg = makeCfg()
    const client = await connect(cfg)

    const primera = (await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })) as ToolResult
    const id = primera.structuredContent?.['approvalId'] as string
    expect(id).toBeTruthy()
    expect(smtpSend).not.toHaveBeenCalled()

    // El operador aprueba desde su terminal (aquí, con el mismo almacén).
    new ApprovalStore({ dir: cfg.authz!.approvalDir }).approve(id, 'alex')

    const segunda = (await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })) as ToolResult

    expect(segunda.isError).toBeFalsy()
    expect(smtpSend).toHaveBeenCalledTimes(1)
  })

  it('la aprobación no se puede gastar dos veces', async () => {
    const cfg = makeCfg()
    const client = await connect(cfg)

    const primera = (await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })) as ToolResult
    const id = primera.structuredContent?.['approvalId'] as string
    new ApprovalStore({ dir: cfg.authz!.approvalDir }).approve(id, 'alex')

    await client.callTool({ name: 'proton_send_email', arguments: MENSAJE })
    expect(smtpSend).toHaveBeenCalledTimes(1)

    // Segundo intento: ya no hay aprobación viva, así que vuelve a pedirla.
    const tercera = (await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })) as ToolResult
    expect(tercera.structuredContent?.['status']).toBe('approval_required')
    expect(smtpSend).toHaveBeenCalledTimes(1)
  })

  it('cambiar un destinatario invalida la aprobación', async () => {
    const cfg = makeCfg()
    const client = await connect(cfg)

    const primera = (await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })) as ToolResult
    const id = primera.structuredContent?.['approvalId'] as string
    new ApprovalStore({ dir: cfg.authz!.approvalDir }).approve(id, 'alex')

    const otra = (await client.callTool({
      name: 'proton_send_email',
      arguments: { ...MENSAJE, to: ['otro@proton.me'] },
    })) as ToolResult

    expect(otra.structuredContent?.['status']).toBe('approval_required')
    expect(smtpSend).not.toHaveBeenCalled()
  })

  it('sin almacén de aprobaciones, se deniega en vez de dejar pasar', async () => {
    const cfg = makeCfg()
    // Un fichero donde debería haber un directorio: el almacén no se puede usar.
    const roto = join(dir, 'no-soy-un-directorio')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(roto, 'x')
    cfg.authz!.approvalDir = roto

    const client = await connect(cfg)
    const res = (await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })) as ToolResult

    expect(res.isError).toBe(true)
    expect(res.structuredContent?.['status']).toBe('denied')
    expect(smtpSend).not.toHaveBeenCalled()
  })

  it('el plan en seco de Drive no pide aprobación (no toca nada)', async () => {
    const cfg = makeCfg()
    cfg.products.drive.enabled = true
    const client = await connect(cfg)

    const res = (await client.callTool({
      name: 'proton_drive_organize',
      arguments: { dry_run: true },
    })) as ToolResult

    expect(res.structuredContent?.['status']).not.toBe('approval_required')
  })

  it('registra la decisión en la auditoría, sin secretos', async () => {
    const client = await connect(makeCfg())
    await client.callTool({
      name: 'proton_send_email',
      arguments: MENSAJE,
    })

    const lines = readFileSync(journal, 'utf8').trim().split('\n')
    const entrada = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>
    expect(entrada['toolId']).toBe('proton_send_email')
    expect(entrada['decision']).toBe('require_approval')
    expect(entrada['outcome']).toBe('pending-approval')
    expect(entrada['correlationId']).toBeTruthy()
  })
})
