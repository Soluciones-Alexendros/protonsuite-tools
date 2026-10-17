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

/**
 * Dependencias del MODO ANTIGUO, en el que el modelo sí transporta la
 * contraseña. Se declara explícitamente porque el valor por defecto es lo
 * contrario: sin argumentos, el secreto no pasa por el modelo (hallazgo F06).
 */
const LEGACY_BRIDGE_DEPS = {
  secretsFromModel: true,
  bridgeUser: 'legacy@proton.me',
  resolvePassword: async () => 'legacy-pass',
} as const

describe('registerBridgeTools — 6 MCP tools', () => {
  it('registra proton_bridge_health', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    expect(capturedTools.has('proton_bridge_health')).toBe(true)
    const tool = capturedTools.get('proton_bridge_health')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
    expect(tool.config.annotations.idempotentHint).toBe(true)
  })

  it('registra proton_bridge_status', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    expect(capturedTools.has('proton_bridge_status')).toBe(true)
    const tool = capturedTools.get('proton_bridge_status')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
  })

  it('registra proton_bridge_info', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    expect(capturedTools.has('proton_bridge_info')).toBe(true)
    const tool = capturedTools.get('proton_bridge_info')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
  })

  it('registra proton_bridge_login', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    expect(capturedTools.has('proton_bridge_login')).toBe(true)
    const tool = capturedTools.get('proton_bridge_login')!
    expect(tool.config.annotations.readOnlyHint).toBe(false)
    expect(tool.config.annotations.destructiveHint).toBe(true)
  })

  it('registra proton_bridge_logout', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    expect(capturedTools.has('proton_bridge_logout')).toBe(true)
    const tool = capturedTools.get('proton_bridge_logout')!
    expect(tool.config.annotations.destructiveHint).toBe(true)
  })

  it('registra proton_bridge_accounts', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    expect(capturedTools.has('proton_bridge_accounts')).toBe(true)
    const tool = capturedTools.get('proton_bridge_accounts')!
    expect(tool.config.annotations.readOnlyHint).toBe(true)
  })

  it('registra exactamente 6 tools', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    const bridgeTools = Array.from(capturedTools.keys()).filter((n) =>
      n.startsWith('proton_bridge_'),
    )
    expect(bridgeTools).toHaveLength(6)
  })

  it('health handler llama client.health()', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    const healthTool = capturedTools.get('proton_bridge_health')!
    const result = await healthTool.handler({ response_format: 'json' })

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(client.health).toHaveBeenCalled()
    expect(result).toBeDefined()
  })

  it('login handler llama client.login() con credenciales', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

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
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    const logoutTool = capturedTools.get('proton_bridge_logout')!
    await logoutTool.handler({})

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(client.logout).toHaveBeenCalled()
  })

  it('accounts handler llama client.listAccounts()', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

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

// ===========================================================================
// T-SEC-02 — El secreto principal no pasa por el modelo (hallazgo F06)
// ===========================================================================

const SECURE_BRIDGE_DEPS = {
  secretsFromModel: false,
  bridgeUser: 'seguro@proton.me',
  resolvePassword: async () => 'la-contrasena-real',
}

describe('T-SEC-02 · login sin secretos en el modelo', () => {
  it('el esquema NO acepta usuario, contraseña ni TOTP', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, SECURE_BRIDGE_DEPS)

    const tool = capturedTools.get('proton_bridge_login')!
    const campos = Object.keys(
      (tool.config as { inputSchema: Record<string, unknown> }).inputSchema,
    )

    expect(campos).toEqual([])
  })

  it('hace login con las credenciales del equipo y no las devuelve', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    const login = vi.spyOn(client, 'login').mockResolvedValue({ ok: true, message: 'logged in' })
    registerBridgeTools(mockRegister, client, silentLog, SECURE_BRIDGE_DEPS)

    const tool = capturedTools.get('proton_bridge_login')!
    const result = (await tool.handler({})) as {
      content: { text: string }[]
      structuredContent: Record<string, unknown>
    }

    expect(login).toHaveBeenCalledWith('seguro@proton.me', 'la-contrasena-real', undefined)
    expect(JSON.stringify(result)).not.toContain('la-contrasena-real')
    expect(result.content[0].text).toContain('Login successful')
    expect(Object.keys(result.structuredContent).sort()).toEqual([
      'message',
      'needs2FA',
      'ok',
    ])
  })

  it('avisa si no hay credenciales configuradas, en vez de pedirlas al modelo', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    const login = vi.spyOn(client, 'login')
    registerBridgeTools(mockRegister, client, silentLog, {
      ...SECURE_BRIDGE_DEPS,
      bridgeUser: '',
    })

    const tool = capturedTools.get('proton_bridge_login')!
    const result = (await tool.handler({})) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('PROTON_BRIDGE_USER')
    expect(login).not.toHaveBeenCalled()
  })

  it('si el origen del secreto falla, lo dice sin filtrar el valor', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog, {
      ...SECURE_BRIDGE_DEPS,
      resolvePassword: async () => {
        throw new Error('pass: no such entry proton/bridge')
      },
    })

    const tool = capturedTools.get('proton_bridge_login')!
    const result = (await tool.handler({})) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('origen configurado')
  })

  it('sin dependencias declaradas, el valor por defecto es el seguro', () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    const tool = capturedTools.get('proton_bridge_login')!
    const campos = Object.keys(
      (tool.config as { inputSchema: Record<string, unknown> }).inputSchema,
    )
    expect(campos).toEqual([])
  })
})

describe('T-SEC-02 · resolución de credenciales, casos límite', () => {
  it('pasa el TOTP cuando está configurado, sin devolverlo', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    const login = vi.spyOn(client, 'login').mockResolvedValue({ ok: true, message: 'ok' })
    registerBridgeTools(mockRegister, client, silentLog, {
      ...SECURE_BRIDGE_DEPS,
      resolveTotp: async () => '123456',
    })

    const tool = capturedTools.get('proton_bridge_login')!
    const result = (await tool.handler({})) as { content: { text: string }[] }

    expect(login).toHaveBeenCalledWith('seguro@proton.me', 'la-contrasena-real', '123456')
    expect(JSON.stringify(result)).not.toContain('123456')
  })

  it('si el TOTP falla, intenta el login sin él', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    const login = vi.spyOn(client, 'login').mockResolvedValue({ ok: true, message: 'ok' })
    registerBridgeTools(mockRegister, client, silentLog, {
      ...SECURE_BRIDGE_DEPS,
      resolveTotp: async () => {
        throw new Error('no hay entrada de TOTP')
      },
    })

    const tool = capturedTools.get('proton_bridge_login')!
    await tool.handler({})

    expect(login).toHaveBeenCalledWith('seguro@proton.me', 'la-contrasena-real', undefined)
  })

  it('avisa si la contraseña resuelta está vacía', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    const login = vi.spyOn(client, 'login')
    registerBridgeTools(mockRegister, client, silentLog, {
      ...SECURE_BRIDGE_DEPS,
      resolvePassword: async () => '',
    })

    const tool = capturedTools.get('proton_bridge_login')!
    const result = (await tool.handler({})) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('PROTON_BRIDGE_PASS')
    expect(login).not.toHaveBeenCalled()
  })

  it('sin configuración de Bridge en el servidor, lo dice', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    registerBridgeTools(mockRegister, client, silentLog)

    const tool = capturedTools.get('proton_bridge_login')!
    const result = (await tool.handler({})) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('configuración del Bridge')
  })
})

describe('modo antiguo · comprobaciones defensivas', () => {
  it('avisa si faltan usuario o contraseña en los argumentos', async () => {
    const client = new BridgeClient('/bin/fake', silentLog)
    const login = vi.spyOn(client, 'login')
    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS)

    const tool = capturedTools.get('proton_bridge_login')!
    const result = (await tool.handler({})) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Faltan user o password')
    expect(login).not.toHaveBeenCalled()
  })
})
