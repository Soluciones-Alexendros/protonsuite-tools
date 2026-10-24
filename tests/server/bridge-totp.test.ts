/**
 * El TOTP también puede venir del almacén de secretos, sin pasar por el modelo.
 *
 * Es la vía para usar 2FA sin teclear el código en cada login ni mandarlo al
 * cliente. Cubre el montaje del resolvedor en `buildServer` (hallazgo F06).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const { passGet, bridgeLogin } = vi.hoisted(() => ({
  passGet: vi.fn(),
  bridgeLogin: vi.fn(),
}))

vi.mock('../../src/pass.js', () => ({
  PassClient: vi.fn().mockImplementation(() => ({ get: passGet })),
}))
vi.mock('../../src/bridge/bridge-client.js', () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({
    health: vi.fn(),
    status: vi.fn(),
    info: vi.fn(),
    listAccounts: vi.fn(),
    login: bridgeLogin,
    logout: vi.fn(),
    spawn: vi.fn(),
    shutdown: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
  })),
}))
vi.mock('../../src/imap.js', () => ({
  ImapClient: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../src/smtp.js', () => ({
  SmtpClient: vi.fn().mockImplementation(() => ({})),
  buildReplyOptions: vi.fn(),
  buildForwardOptions: vi.fn(),
}))

import { buildServer } from '../../src/server.js'
import type { Config } from '../../src/config.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-totp-'))
  passGet.mockReset()
  bridgeLogin.mockReset()
  bridgeLogin.mockResolvedValue({ ok: true, message: 'logged in' })
  passGet.mockResolvedValue('654321')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const silentLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

function makeCfg(totpPath?: string): Config {
  return {
    products: {
      mail: {
        enabled: true,
        bridge: {
          user: 'op@proton.me',
          pass: 'x',
          ...(totpPath !== undefined ? { totpPath } : {}),
          host: '127.0.0.1',
          imapPort: 1143,
          smtpPort: 1025,
          from: 'op@proton.me',
          tlsInsecure: true,
          imapSecurity: 'starttls', smtpSecurity: 'starttls',
        },
      },
      pass: { enabled: true, storeDir: dir },
      calendar: { enabled: false, experimental: false },
      drive: { enabled: false, cliBin: 'proton-drive', stagingDir: dir, obsoleteExtensions: [] },
    },
    transport: { kind: 'stdio', httpHost: '127.0.0.1', httpPort: 8787, allowedOrigins: [] },
    alerts: { enabled: false, logDir: dir, minSeverity: 'warning' },
    agent: { dryRun: true, maxInspectEmails: 10, minConfidence: 0.6 },
    // Política declarada: aquí se prueba el TOTP, no la autorización. Sin esto,
    // el login (clase admin) pediría aprobación y no llegaría al Bridge, que es
    // justo lo que debe pasar en el perfil por defecto.
    authz: {
      mode: 'enforce',
      actor: 'test',
      approvalDir: join(dir, 'approvals'),
      journalFile: null,
      allow: ['read', 'write', 'destructive', 'admin'],
      requireApproval: [],
    },
    logLevel: 'error',
  } as Config
}

async function llamarLogin(cfg: Config) {
  const { server } = buildServer(cfg, silentLog)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverT), client.connect(clientT)])
  const res = await client.callTool({ name: 'proton_bridge_login', arguments: {} })
  await client.close()
  return res
}

describe('login del Bridge · TOTP desde el almacén', () => {
  it('resuelve el TOTP configurado y lo usa, sin devolverlo', async () => {
    const res = await llamarLogin(makeCfg('proton/bridge/totp'))

    expect(passGet).toHaveBeenCalledWith('proton/bridge/totp')
    expect(bridgeLogin).toHaveBeenCalledWith('op@proton.me', 'x', '654321')
    expect(JSON.stringify(res)).not.toContain('654321')
  })

  it('sin ruta de TOTP, no consulta el almacén', async () => {
    await llamarLogin(makeCfg())

    expect(passGet).not.toHaveBeenCalled()
    expect(bridgeLogin).toHaveBeenCalledWith('op@proton.me', 'x', undefined)
  })
})
