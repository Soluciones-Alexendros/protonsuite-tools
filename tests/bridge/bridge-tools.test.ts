import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/bridge/bridge-client.js', () => {
  return {
    BridgeClient: vi.fn().mockImplementation(() => ({
      health: vi.fn().mockResolvedValue({
        ok: true,
        processRunning: true,
        imapListening: true,
        smtpListening: true,
        authOk: true,
      }),
      status: vi.fn().mockResolvedValue({
        user: 'u@proton.me',
        version: '3.15',
        processRunning: true,
        imapListening: true,
        smtpListening: true,
        authOk: true,
      }),
      info: vi.fn().mockResolvedValue({
        user: 'u@proton.me',
        version: '3.15',
        bridgePassword: '***',
      }),
      login: vi.fn().mockResolvedValue({ ok: true, message: 'logged in' }),
      logout: vi.fn().mockResolvedValue({ ok: true }),
      listAccounts: vi.fn().mockResolvedValue([]),
      spawn: vi.fn(),
      shutdown: vi.fn(),
      isRunning: vi.fn().mockReturnValue(true),
    })),
  }
})

import { BridgeClient } from '../../src/bridge/bridge-client.js'
import { registerBridgeTools } from '../../src/server/bridge.js'

const capturedTools = new Map<
  string,
  { config: unknown; handler: (...args: unknown[]) => unknown }
>()

function mockRegister(
  name: string,
  config: unknown,
  handler: (...args: unknown[]) => unknown,
) {
  capturedTools.set(name, { config, handler })
}

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

beforeEach(() => {
  capturedTools.clear()
})

describe('registerBridgeTools — 6 MCP tools', () => {
  it('registra proton_bridge_health', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    expect(capturedTools.has('proton_bridge_health')).toBe(true)
    const tool = capturedTools.get('proton_bridge_health')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
    expect(tool.config.annotations.idempotentHint).toBe(true)
  })

  it('registra proton_bridge_status', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    expect(capturedTools.has('proton_bridge_status')).toBe(true)
    const tool = capturedTools.get('proton_bridge_status')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
  })

  it('registra proton_bridge_info', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    expect(capturedTools.has('proton_bridge_info')).toBe(true)
    const tool = capturedTools.get('proton_bridge_info')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
  })

  it('registra proton_bridge_login', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    expect(capturedTools.has('proton_bridge_login')).toBe(true)
    const tool = capturedTools.get('proton_bridge_login')!
    expect(tool.config.annotations.readOnlyHint).toBe(false)
    expect(tool.config.annotations.destructiveHint).toBe(true)
  })

  it('registra proton_bridge_logout', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    expect(capturedTools.has('proton_bridge_logout')).toBe(true)
    const tool = capturedTools.get('proton_bridge_logout')!
    expect(tool.config.annotations.destructiveHint).toBe(true)
  })

  it('registra proton_bridge_accounts', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    expect(capturedTools.has('proton_bridge_accounts')).toBe(true)
    const tool = capturedTools.get('proton_bridge_accounts')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
  })

  it('registra exactamente 6 tools', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    const bridgeTools = Array.from(capturedTools.keys()).filter((n) =>
      n.startsWith('proton_bridge_'),
    )
    expect(bridgeTools).toHaveLength(6)
  })

  it('health handler llama client.health()', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    const healthTool = capturedTools.get('proton_bridge_health')!
    const result = await healthTool.handler({ response_format: 'json' })

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(client.health).toHaveBeenCalled()
    expect(result).toBeDefined()
  })

  it('login handler llama client.login() con credenciales', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    const loginTool = capturedTools.get('proton_bridge_login')!
    await loginTool.handler({
      user: 'u@proton.me',
      password: 'secret',
      totp: '123456',
    })

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(client.login).toHaveBeenCalledWith('u@proton.me', 'secret', '123456')
  })

  it('logout handler llama client.logout()', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    const logoutTool = capturedTools.get('proton_bridge_logout')!
    await logoutTool.handler({})

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(client.logout).toHaveBeenCalled()
  })

  it('accounts handler llama client.listAccounts()', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    const accountsTool = capturedTools.get('proton_bridge_accounts')!
    await accountsTool.handler({ response_format: 'markdown' })

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(client.listAccounts).toHaveBeenCalled()
  })
})

// ===========================================================================
// T-SEC-01 — El límite MCP no reenvía secretos (hallazgo F04)
// ===========================================================================

const DECOY = 'DECOY-bridge-password-abc123'

/**
 * Cliente hostil: devuelve señuelos en todos los campos, incluido uno que NO
 * pertenece al contrato público. El servidor debe filtrar por lista positiva
 * y no reenviar nada que no esté declarado.
 */
function decoyBridge() {
  const status = {
    user: 'u@proton.me',
    version: '3.15',
    imapPort: 1143,
    smtpPort: 1025,
    processRunning: true,
    imapListening: true,
    smtpListening: true,
    authOk: true,
    bridgePassword: DECOY,
    password: DECOY,
    totp: DECOY,
  }
  return {
    health: () => Promise.resolve({ ...status, ok: true }),
    status: () => Promise.resolve(status),
    info: () =>
      Promise.resolve({
        user: 'u@proton.me',
        version: '3.15',
        imapPort: 1143,
        smtpPort: 1025,
        bridgePassword: DECOY,
      }),
  } as unknown as BridgeClient
}

describe('T-SEC-01 — ningún señuelo cruza el límite MCP', () => {
  it('proton_bridge_info no propaga la contraseña', async () => {
    registerBridgeTools(mockRegister, decoyBridge(), silentLog)
    const tool = capturedTools.get('proton_bridge_info')!

    const result = (await tool.handler({})) as {
      content: { text: string }[]
      structuredContent: Record<string, unknown>
    }

    expect(JSON.stringify(result)).not.toContain(DECOY)
    expect(result.content[0].text).not.toContain(DECOY)
    expect(Object.keys(result.structuredContent)).not.toContain('bridgePassword')
    expect(Object.keys(result.structuredContent).sort()).toEqual([
      'imapPort',
      'smtpPort',
      'user',
      'version',
    ])
  })

  it('proton_bridge_status (json) no propaga campos fuera de la lista positiva', async () => {
    registerBridgeTools(mockRegister, decoyBridge(), silentLog)
    const tool = capturedTools.get('proton_bridge_status')!

    const result = (await tool.handler({ response_format: 'json' })) as {
      content: { text: string }[]
      structuredContent: Record<string, unknown>
    }

    expect(JSON.stringify(result)).not.toContain(DECOY)
    expect(Object.keys(result.structuredContent)).not.toContain('bridgePassword')
    expect(Object.keys(result.structuredContent)).not.toContain('password')
    expect(Object.keys(result.structuredContent)).not.toContain('totp')
  })

  it('proton_bridge_status (markdown) no propaga la contraseña', async () => {
    registerBridgeTools(mockRegister, decoyBridge(), silentLog)
    const tool = capturedTools.get('proton_bridge_status')!

    const result = (await tool.handler({ response_format: 'markdown' })) as {
      content: { text: string }[]
    }

    expect(result.content[0].text).not.toContain(DECOY)
  })

  it('proton_bridge_health (json) no propaga la contraseña', async () => {
    registerBridgeTools(mockRegister, decoyBridge(), silentLog)
    const tool = capturedTools.get('proton_bridge_health')!

    const result = (await tool.handler({ response_format: 'json' })) as {
      content: { text: string }[]
      structuredContent: Record<string, unknown>
    }

    expect(JSON.stringify(result)).not.toContain(DECOY)
    expect(Object.keys(result.structuredContent)).not.toContain('bridgePassword')
  })
})
