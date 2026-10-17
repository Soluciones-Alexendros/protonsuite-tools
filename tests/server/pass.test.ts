/**
 * Tests para src/server/pass.ts (60.26% → objetivo ~95%).
 *
 * registerPassTools registra 8 MCP tools para Pass.
 * Mockea PassClient via vi.mock('../../src/pass.js').
 * Usa captureHandler para interceptar registerTool.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerPassTools } from '../../src/server/pass.js'

const hoisted = vi.hoisted(() => {
  const mockList = vi.fn()
  const mockGet = vi.fn()
  const mockGenerate = vi.fn()
  const mockHealth = vi.fn()
  const mockInsert = vi.fn()
  const mockRemove = vi.fn()
  const mockMove = vi.fn()
  const mockCopy = vi.fn()

  const mockPassClient = {
    list: mockList,
    get: mockGet,
    generate: mockGenerate,
    health: mockHealth,
    insert: mockInsert,
    remove: mockRemove,
    move: mockMove,
    copy: mockCopy,
  }

  const silentLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

  return { mockPassClient, silentLog, mockList, mockGet, mockGenerate, mockHealth, mockInsert, mockRemove, mockMove, mockCopy }
})

vi.mock('../../src/pass.js', () => ({
  PassClient: vi.fn(() => hoisted.mockPassClient),
}))

const defaultCfg = {
  products: {
    pass: { enabled: true, storeDir: '/tmp/store' },
  },
} as never

/**
 * Modo antiguo declarado a propósito: estas pruebas comprueban el
 * comportamiento de insertar, no el control sobre el secreto.
 */
const cfgConSecretos = {
  products: {
    pass: { enabled: true, storeDir: '/tmp/store' },
  },
  secrets: { fromModel: true },
} as never

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<{
    content: { type: string; text: string }[]
    isError?: boolean
  }>

function captureHandler() {
  const handlers = new Map<string, ToolHandler>()
  const schemas = new Map<string, { inputSchema?: Record<string, unknown> }>()
  const server = {
    registerTool: vi.fn((name: string, schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
      schemas.set(name, schema as { inputSchema?: Record<string, unknown> })
    }),
  } as unknown as McpServer
  return {
    server,
    /** Esquema registrado, para poder afirmar qué argumentos NO acepta. */
    schemaOf: (toolName: string) => schemas.get(toolName),
    invoke: async (toolName: string, args: Record<string, unknown> = {}) => {
      const handler = handlers.get(toolName)
      if (!handler) throw new Error(`Tool "${toolName}" not registered`)
      return handler(args)
    },
  }
}

// ===========================================================================
// registerPassTools
// ===========================================================================

describe('registerPassTools', () => {
  describe('proton_pass_list', () => {
    it('devuelve JSON con entries y count por defecto', async () => {
      hoisted.mockList.mockResolvedValue(['entry1', 'entry2'])
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      // Nota: response_format se pasa explícitamente porque el handler
      // se invoca directo (sin Zod), y Zod.default('json') no se aplica.
      const result = await invoke('proton_pass_list', { response_format: 'json' })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.entries).toEqual(['entry1', 'entry2'])
      expect(parsed.count).toBe(2)
    })

    it('devuelve markdown con response_format=markdown', async () => {
      hoisted.mockList.mockResolvedValue(['proton/bridge', 'proton/mail'])
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_list', { response_format: 'markdown' })
      expect(result.content[0].text).toContain('2 entries')
      expect(result.content[0].text).toContain('proton/bridge')
    })

    it('filtra por filter', async () => {
      hoisted.mockList.mockResolvedValue(['filtered/entry'])
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      await invoke('proton_pass_list', { filter: 'filtered' })
      expect(hoisted.mockList).toHaveBeenCalledWith('filtered')
    })

    it('devuelve isError cuando list lanza', async () => {
      hoisted.mockList.mockRejectedValue(new Error('ENOENT'))
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_list', {})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('ENOENT')
    })

    it('no registra tools cuando pass no está enabled', () => {
      const { server } = captureHandler()
      registerPassTools(server, {
        cfg: { products: { pass: { enabled: false } } } as never,
        log: hoisted.silentLog,
      })
      expect((server as { registerTool: ReturnType<typeof vi.fn> }).registerTool).not.toHaveBeenCalled()
    })
  })

  describe('proton_pass_get', () => {
    it('devuelve {found:true} cuando get resuelve', async () => {
      hoisted.mockGet.mockResolvedValue('secret-value')
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_get', { path: 'proton/bridge' })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.found).toBe(true)
      expect(parsed.path).toBe('proton/bridge')
      expect(parsed.injected).toBe(true)
      // No debe contener el valor del secreto
      expect(result.content[0].text).not.toContain('secret-value')
    })

    it('devuelve {found:false} con error cuando get lanza', async () => {
      hoisted.mockGet.mockRejectedValue(new Error('not found'))
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_get', { path: 'missing/entry' })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.found).toBe(false)
      expect(parsed.error).toBeTruthy()
      expect(result.isError).toBeUndefined() // No es isError, devuelve objeto con error
    })
  })

  describe('proton_pass_generate', () => {
    it('genera con path y length por defecto', async () => {
      hoisted.mockGenerate.mockResolvedValue({ path: 'new/pass', length: 24 })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      // Nota: length se pasa explícitamente porque el handler se invoca
      // directo (sin Zod), y Zod.default(24) no se aplica.
      const result = await invoke('proton_pass_generate', { path: 'new/pass', length: 24 })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.generated).toBe(true)
      expect(parsed.length).toBe(24)
      expect(hoisted.mockGenerate).toHaveBeenCalledWith('new/pass', 24, {})
    })

    it('genera con length personalizado', async () => {
      hoisted.mockGenerate.mockResolvedValue({ path: 'new/pass', length: 40 })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_generate', { path: 'new/pass', length: 40 })
      expect(result.isError).toBeUndefined()
    })

    it('devuelve isError cuando lanza', async () => {
      hoisted.mockGenerate.mockRejectedValue(new Error('gpg error'))
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_generate', { path: 'bad/pass' })
      expect(result.isError).toBe(true)
    })
  })

  describe('proton_pass_health', () => {
    it('devuelve JSON con estado', async () => {
      hoisted.mockHealth.mockResolvedValue({ ok: true, entries: 10 })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_health', {})
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.ok).toBe(true)
      expect(parsed.entries).toBe(10)
    })
  })

  describe('proton_pass_insert', () => {
    it('inserta y devuelve mensaje', async () => {
      hoisted.mockInsert.mockResolvedValue({ ok: true, path: 'new/entry' })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: cfgConSecretos, log: hoisted.silentLog })

      const result = await invoke('proton_pass_insert', { path: 'new/entry', secret: 's3cr3t' })
      expect(result.content[0].text).toContain('Inserted entry')
      expect(hoisted.mockInsert).toHaveBeenCalledWith('new/entry', 's3cr3t', {})
      // El secreto no debe aparecer en el log ni en la respuesta
      expect(result.content[0].text).not.toContain('s3cr3t')
    })

    it('sin opt-in devuelve isError cuando la entrada ya existe (F01)', async () => {
      hoisted.mockInsert.mockRejectedValue(new Error('Entry already exists: new/entry'))
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: cfgConSecretos, log: hoisted.silentLog })

      const result = await invoke('proton_pass_insert', { path: 'new/entry', secret: 's3cr3t' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('already exists')
      expect(result.content[0].text).not.toContain('s3cr3t')
    })

    it('con overwrite:true informa de la copia de seguridad', async () => {
      hoisted.mockInsert.mockResolvedValue({
        ok: true,
        path: 'new/entry',
        backupPath: '/store/new/entry.gpg.bak.1',
      })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: cfgConSecretos, log: hoisted.silentLog })

      const result = await invoke('proton_pass_insert', {
        path: 'new/entry',
        secret: 's3cr3t',
        overwrite: true,
      })
      expect(hoisted.mockInsert).toHaveBeenCalledWith('new/entry', 's3cr3t', { overwrite: true })
      expect(result.content[0].text).toContain('backup: /store/new/entry.gpg.bak.1')
    })
  })

  describe('proton_pass_remove', () => {
    it('elimina y devuelve mensaje', async () => {
      hoisted.mockRemove.mockResolvedValue({ ok: true, path: 'old/entry' })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_remove', { path: 'old/entry' })
      expect(result.content[0].text).toContain('Removed entry')
      expect(hoisted.mockRemove).toHaveBeenCalledWith('old/entry')
    })
  })

  describe('proton_pass_move', () => {
    it('mueve y devuelve flecha', async () => {
      hoisted.mockMove.mockResolvedValue({ ok: true, from: 'a', to: 'b' })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_move', { from: 'a', to: 'b' })
      expect(result.content[0].text).toContain('→')
      expect(result.content[0].text).toContain('a')
      expect(result.content[0].text).toContain('b')
    })
  })

  describe('proton_pass_copy', () => {
    it('copia y devuelve flecha', async () => {
      hoisted.mockCopy.mockResolvedValue({ ok: true, src: 's', dst: 'd' })
      const { server, invoke } = captureHandler()
      registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

      const result = await invoke('proton_pass_copy', { src: 's', dst: 'd' })
      expect(result.content[0].text).toContain('→')
      expect(result.content[0].text).toContain('s')
    })
  })
})

describe('proton_pass_insert · perfil seguro (T-SEC-02)', () => {
  it('el esquema NO acepta el secreto: el modelo no lo transporta', async () => {
    const { server, schemaOf } = captureHandler()
    registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

    const campos = Object.keys(schemaOf('proton_pass_insert')?.inputSchema ?? {})
    expect(campos).toContain('path')
    expect(campos).not.toContain('secret')
  })

  it('la llamada explica cómo hacerlo bien y no guarda nada', async () => {
    const { server, invoke } = captureHandler()
    registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

    const result = await invoke('proton_pass_insert', { path: 'proton/bridge' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('pass insert proton/bridge')
    expect(result.structuredContent.status).toBe('refused')
    expect(hoisted.mockInsert).not.toHaveBeenCalled()
  })
})

describe('proton_pass_list · sin entradas', () => {
  it('lo dice claramente cuando el almacén está vacío', async () => {
    hoisted.mockList.mockResolvedValue([])
    const { server, invoke } = captureHandler()
    registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

    const result = await invoke('proton_pass_list', { response_format: 'markdown' })
    expect(result.content[0].text).toContain('No entries found')
  })
})

describe('proton_pass_list · formatos', () => {
  // Nota: el handler se invoca directo (sin Zod), así que hay que pasar
  // response_format explícitamente; el default del esquema no se aplica.
  it('lista en json', async () => {
    hoisted.mockList.mockResolvedValue(['a', 'b'])
    const { server, invoke } = captureHandler()
    registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

    const result = await invoke('proton_pass_list', { response_format: 'json' })
    expect(result.content[0].text).toContain('"count"')
  })

  it('acepta un filtro', async () => {
    hoisted.mockList.mockResolvedValue(['proton/bridge'])
    const { server, invoke } = captureHandler()
    registerPassTools(server, { cfg: defaultCfg, log: hoisted.silentLog })

    const result = await invoke('proton_pass_list', {
      filter: 'proton',
      response_format: 'json',
    })
    expect(JSON.parse(result.content[0].text).entries).toEqual(['proton/bridge'])
  })
})
