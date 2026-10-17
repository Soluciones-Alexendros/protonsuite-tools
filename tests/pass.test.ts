/**
 * Tests para src/pass.ts (60.71% → objetivo ~95%).
 *
 * PassClient opera sobre pass-cli via execFile (ChildProcess event API).
 * Mock: execFile devuelve un objeto ChildProcess-like que captura handlers.
 * Los tests disparan eventos con emitData / emitClose tras la llamada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PassClient, PassError } from '../src/pass.js'

const hoisted = vi.hoisted(() => {
  const captured: Array<{
    emitData: (d: string) => void
    emitStderr: (d: string) => void
    emitClose: (code: number) => void
    emitError: (err: Error) => void
    stdinWrite: ReturnType<typeof vi.fn>
    stdinEnd: ReturnType<typeof vi.fn>
  }> = []

  const mockExecFile = vi.fn((_bin: string, _args: string[], _opts: { input?: string }) => {
    let dataHandler: ((d: string) => void) | null = null
    let stderrHandler: ((d: string) => void) | null = null
    let closeHandler: ((code: number) => void) | null = null
    let errorHandler: ((err: Error) => void) | null = null
    const stdinWrite = vi.fn()
    const stdinEnd = vi.fn()

    const entry = {
      emitData: (d: string) => dataHandler?.(d),
      emitStderr: (d: string) => stderrHandler?.(d),
      emitClose: (code: number) => closeHandler?.(code),
      emitError: (err: Error) => errorHandler?.(err),
      stdinWrite,
      stdinEnd,
    }
    captured.push(entry)

    return {
      stdout: { on: (_e: string, h: (d: string) => void) => { dataHandler = h } },
      stderr: { on: (_e: string, h: (d: string) => void) => { stderrHandler = h } },
      stdin: { write: stdinWrite, end: stdinEnd },
      on: (_e: string, h: ((code: number) => void) | ((err: Error) => void)) => {
        if (_e === 'close') closeHandler = h as (code: number) => void
        if (_e === 'error') errorHandler = h as (err: Error) => void
      },
    }
  })

  const mockReaddir = vi.fn()
  const mockStat = vi.fn().mockResolvedValue({ mtimeMs: Date.now() })
  const mockCopyFile = vi.fn().mockResolvedValue(undefined)
  const silentLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  return { mockExecFile, mockReaddir, mockStat, mockCopyFile, silentLog, captured }
})

vi.mock('node:child_process', () => ({
  execFile: hoisted.mockExecFile,
}))

vi.mock('node:fs/promises', () => ({
  readdir: hoisted.mockReaddir,
  stat: hoisted.mockStat,
  copyFile: hoisted.mockCopyFile,
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.captured.length = 0
  hoisted.mockStat.mockResolvedValue({ mtimeMs: Date.now() })
})

function makeClient(storeDir = '/tmp/password-store') {
  return new PassClient({ storeDir }, hoisted.silentLog)
}

/**
 * `generate`/`insert` comprueban la existencia de la entrada (await stat)
 * ANTES de invocar el CLI, así que los tests deben ceder el control antes de
 * inspeccionar la llamada capturada.
 */
const flushTicks = () => new Promise((resolve) => setImmediate(resolve))

describe('PassClient', () => {
  describe('constructor', () => {
    it('resuelve storeDir con ~', () => {
      const c = new PassClient({ storeDir: '~/pass-store' }, hoisted.silentLog)
      expect(c).toBeDefined()
    })
  })

  describe('list', () => {
    it('lista entradas .gpg del store', async () => {
      hoisted.mockReaddir.mockResolvedValue(['entry1.gpg', 'entry2.gpg', 'note.txt'])
      const result = await makeClient().list()
      expect(result).toEqual(['entry1', 'entry2'])
    })

    it('filtra por string cuando se pasa filter', async () => {
      hoisted.mockReaddir.mockResolvedValue(['proton/bridge.gpg', 'proton/mail.gpg', 'personal/gmail.gpg'])
      const result = await makeClient().list('proton')
      expect(result).toEqual(['proton/bridge', 'proton/mail'])
    })

    it('devuelve array vacío si filter no coincide', async () => {
      hoisted.mockReaddir.mockResolvedValue(['entry.gpg'])
      const result = await makeClient().list('nonexistent')
      expect(result).toEqual([])
    })
  })

  describe('get', () => {
    it('devuelve primera línea del secreto', async () => {
      const c = makeClient()
      const promise = c.get('proton/bridge')
      const entry = hoisted.captured[0]
      entry.emitData('my-secret-password\nline2\n')
      entry.emitClose(0)
      const result = await promise
      expect(result).toBe('my-secret-password')
    })

    it('lanza PassError NOT_FOUND cuando stderr contiene "not in the password store"', async () => {
      const c = makeClient()
      const promise = c.get('missing/entry')
      const entry = hoisted.captured[0]
      entry.emitStderr('pass: entry not in the password store')
      entry.emitClose(1)
      await expect(promise).rejects.toThrow(PassError)
      await expect(promise).rejects.toThrow('Entry not found')
    })

    it('lanza PassError READ_ERROR cuando stderr contiene otros errores', async () => {
      const c = makeClient()
      const promise = c.get('weird/entry')
      const entry = hoisted.captured[0]
      entry.emitStderr('gpg: decryption failed')
      entry.emitClose(1)
      await expect(promise).rejects.toThrow('Failed to read')
    })

    it('lanza PassError INVALID_PATH para path con ..', async () => {
      await expect(makeClient().get('../etc/passwd')).rejects.toThrow('Invalid entry path')
      expect(hoisted.mockExecFile).not.toHaveBeenCalled()
    })

    it('lanza PassError INVALID_PATH para path con caracteres peligrosos', async () => {
      await expect(makeClient().get('entry; rm -rf /')).rejects.toThrow('Invalid entry path')
    })
  })

  describe('exists', () => {
    it('true cuando el ciphertext existe', async () => {
      hoisted.mockStat.mockResolvedValue({ mtimeMs: 1 })
      await expect(makeClient().exists('proton/bridge')).resolves.toBe(true)
    })

    it('false cuando stat lanza ENOENT', async () => {
      hoisted.mockStat.mockRejectedValue(new Error('ENOENT'))
      await expect(makeClient().exists('proton/missing')).resolves.toBe(false)
    })

    it('valida el path antes de tocar el disco', async () => {
      await expect(makeClient().exists('../escape')).rejects.toThrow('Invalid entry path')
      expect(hoisted.mockStat).not.toHaveBeenCalled()
    })
  })

  describe('generate', () => {
    beforeEach(() => {
      // Precondición: la entrada NO existe (no-clobber).
      hoisted.mockStat.mockRejectedValue(new Error('ENOENT'))
    })

    it('genera contraseña y la inserta via execFile', async () => {
      const c = makeClient()
      const promise = c.generate('new/entry', 30)
      await flushTicks()
      const entry = hoisted.captured[0]
      expect(entry.stdinWrite).toHaveBeenCalled()
      entry.emitClose(0)
      const result = await promise
      expect(result.path).toBe('new/entry')
      expect(result.length).toBe(30)
      expect(result.backupPath).toBeUndefined()
    })

    it('lanza error cuando execFile falla', async () => {
      const c = makeClient()
      const promise = c.generate('new/entry', 12)
      await flushTicks()
      const entry = hoisted.captured[0]
      entry.emitError(new Error('EPERM'))
      await expect(promise).rejects.toThrow()
    })
  })

  describe('generate · no-clobber (F01)', () => {
    beforeEach(() => {
      // Precondición: la entrada YA existe.
      hoisted.mockStat.mockResolvedValue({ mtimeMs: 1 })
    })

    it('se niega a sobrescribir sin opt-in explícito', async () => {
      const c = makeClient()
      await expect(c.generate('proton/bridge', 24)).rejects.toThrow(PassError)
      await expect(c.generate('proton/bridge', 24)).rejects.toThrow('already exists')
      expect(hoisted.mockExecFile).not.toHaveBeenCalled()
      expect(hoisted.mockCopyFile).not.toHaveBeenCalled()
    })

    it('con overwrite:true hace copia de seguridad antes de escribir', async () => {
      const c = makeClient()
      const promise = c.generate('proton/bridge', 24, { overwrite: true })
      await flushTicks()
      const entry = hoisted.captured[0]
      entry.emitClose(0)
      const result = await promise
      expect(hoisted.mockCopyFile).toHaveBeenCalledTimes(1)
      const [src, dst] = hoisted.mockCopyFile.mock.calls[0] as [string, string]
      expect(src).toBe('/tmp/password-store/proton/bridge.gpg')
      expect(dst).toMatch(/^\/tmp\/password-store\/proton\/bridge\.gpg\.bak\.\d+$/)
      expect(result.backupPath).toBe(dst)
      expect(hoisted.silentLog.warn).toHaveBeenCalledWith(
        'pass backup before overwrite',
        { path: 'proton/bridge' },
      )
    })
  })

  describe('health', () => {
    it('ok=true con entries count', async () => {
      hoisted.mockReaddir.mockResolvedValue(['a.gpg', 'b.gpg'])
      const result = await makeClient().health()
      expect(result.ok).toBe(true)
      expect(result.entries).toBe(2)
    })

    it('ok=false cuando list lanza', async () => {
      hoisted.mockReaddir.mockRejectedValue(new Error('ENOENT'))
      const result = await makeClient().health()
      expect(result.ok).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('insert', () => {
    it('inserta secreto y devuelve path', async () => {
      hoisted.mockStat.mockRejectedValue(new Error('ENOENT'))
      const c = makeClient()
      const promise = c.insert('new/entry', 'super-secret')
      await flushTicks()
      const entry = hoisted.captured[0]
      expect(entry.stdinWrite).toHaveBeenCalledWith('super-secret')
      entry.emitClose(0)
      const result = await promise
      expect(result.path).toBe('new/entry')
      expect(result.backupPath).toBeUndefined()
    })

    it('se niega a sobrescribir sin opt-in explícito (F01)', async () => {
      hoisted.mockStat.mockResolvedValue({ mtimeMs: 1 })
      await expect(makeClient().insert('proton/bridge', 'x')).rejects.toThrow(
        'already exists',
      )
      expect(hoisted.mockExecFile).not.toHaveBeenCalled()
    })

    it('con overwrite:true respalda el ciphertext anterior', async () => {
      hoisted.mockStat.mockResolvedValue({ mtimeMs: 1 })
      const c = makeClient()
      const promise = c.insert('proton/bridge', 'nuevo', { overwrite: true })
      await flushTicks()
      const entry = hoisted.captured[0]
      entry.emitClose(0)
      const result = await promise
      expect(hoisted.mockCopyFile).toHaveBeenCalledTimes(1)
      expect(result.backupPath).toMatch(/\.bak\.\d+$/)
    })
  })

  describe('remove', () => {
    it('elimina entrada y devuelve path', async () => {
      const c = makeClient()
      const promise = c.remove('old/entry')
      const entry = hoisted.captured[0]
      entry.emitClose(0)
      const result = await promise
      expect(result.path).toBe('old/entry')
    })

    it('llama execFile con rm -f', () => {
      makeClient().remove('old/entry').catch(() => {})
      expect(hoisted.mockExecFile).toHaveBeenCalledWith('pass', ['rm', '-f', 'old/entry'], expect.any(Object))
    })
    it('llama execFile con gopass cuando backend=gopass', () => {
      const c = new PassClient({ storeDir: '/tmp/s', backend: 'gopass' }, hoisted.silentLog)
      c.remove('old/entry').catch(() => {})
      expect(hoisted.mockExecFile).toHaveBeenCalledWith('gopass', ['rm', '-f', 'old/entry'], expect.any(Object))
    })
  })

  describe('move', () => {
    it('mueve entrada y devuelve from/to', async () => {
      const c = makeClient()
      const promise = c.move('old/path', 'new/path')
      const entry = hoisted.captured[0]
      entry.emitClose(0)
      const result = await promise
      expect(result.from).toBe('old/path')
      expect(result.to).toBe('new/path')
    })

    it('llama execFile con mv', () => {
      makeClient().move('a', 'b').catch(() => {})
      expect(hoisted.mockExecFile).toHaveBeenCalledWith('pass', ['mv', 'a', 'b'], expect.any(Object))
    })
  })

  describe('copy', () => {
    it('copia entrada y devuelve src/dst', async () => {
      const c = makeClient()
      const promise = c.copy('src/entry', 'dst/entry')
      const entry = hoisted.captured[0]
      entry.emitClose(0)
      const result = await promise
      expect(result.src).toBe('src/entry')
      expect(result.dst).toBe('dst/entry')
    })

    it('llama execFile con cp', () => {
      makeClient().copy('s', 'd').catch(() => {})
      expect(hoisted.mockExecFile).toHaveBeenCalledWith('pass', ['cp', 's', 'd'], expect.any(Object))
    })
  })

  describe('audit', () => {
    it('storeOk=false cuando health falla', async () => {
      hoisted.mockReaddir.mockRejectedValue(new Error('ENOENT'))
      const result = await makeClient().audit()
      expect(result.storeOk).toBe(false)
      expect(result.recommendations.length).toBeGreaterThan(0)
    })

    it('detecta contraseñas débiles y duplicados', async () => {
      hoisted.mockReaddir.mockResolvedValue(['weak.gpg', 'strong.gpg', 'dup.gpg'])
      const c = makeClient()

      // audit() necesita que cada get() resuelva antes de pasar al siguiente entry
      // Por eso emitimos eventos incrementalmente: capturamos 1, resolvemos 1, etc.
      const promise = c.audit()

      // Esperar a que audit procese health + list y llame al primer get()
      for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
      expect(hoisted.captured.length).toBe(1)

      // Resolver entry 1: 'abc' → débil
      hoisted.captured[0].emitData('abc\n')
      hoisted.captured[0].emitClose(0)
      for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
      expect(hoisted.captured.length).toBe(2)

      // Resolver entry 2: 'StrongP@ss1' → fuerte
      hoisted.captured[1].emitData('StrongP@ss1\n')
      hoisted.captured[1].emitClose(0)
      for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
      expect(hoisted.captured.length).toBe(3)

      // Resolver entry 3: 'abc' → débil + duplicado
      hoisted.captured[2].emitData('abc\n')
      hoisted.captured[2].emitClose(0)

      const result = await promise
      expect(result.storeOk).toBe(true)
      expect(result.totalEntries).toBe(3)
      expect(result.weakPasswords).toContain('weak')
      expect(result.duplicates.length).toBeGreaterThanOrEqual(1)
      expect(result.rotationPlan.some((i) => i.path === 'weak' && i.reason === 'weak')).toBe(true)
      expect(result.rotationPlan.some((i) => i.path === 'dup')).toBe(true)
    })

    it('un duplicado fuerte y no débil entra en el plan como duplicate', async () => {
      hoisted.mockReaddir.mockResolvedValue(['primera.gpg', 'segunda.gpg'])
      hoisted.mockStat.mockResolvedValue({ mtimeMs: Date.now() })
      const c = makeClient()

      const promise = c.audit()
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
      hoisted.captured[0].emitData('StrongP@ssw0rd\n')
      hoisted.captured[0].emitClose(0)
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
      hoisted.captured[1].emitData('StrongP@ssw0rd\n')
      hoisted.captured[1].emitClose(0)

      const result = await promise
      expect(result.weakPasswords).toEqual([])
      expect(result.staleEntries).toEqual([])
      expect(result.duplicates).toHaveLength(1)
      expect(result.rotationPlan).toEqual([
        { path: 'segunda', reason: 'duplicate', action: 'regenerate' },
      ])
    })

    it('marca stale por mtime antiguo y usa backend gopass', async () => {
      hoisted.mockReaddir.mockResolvedValue(['old.gpg'])
      hoisted.mockStat.mockResolvedValue({ mtimeMs: Date.now() - 400 * 86_400_000 })
      const c = new PassClient(
        { storeDir: '/tmp/password-store', backend: 'gopass', staleAfterMs: 365 * 86_400_000 },
        hoisted.silentLog,
      )
      expect(c.getBackendBinary()).toBe('gopass')
      const promise = c.audit()
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
      hoisted.captured[0].emitData('StrongP@ss1234!\n')
      hoisted.captured[0].emitClose(0)
      const result = await promise
      expect(result.staleEntries).toContain('old')
      expect(result.rotationPlan.some((i) => i.path === 'old' && i.reason === 'stale')).toBe(true)
    })

    it('ignora stale cuando stat falla', async () => {
      hoisted.mockReaddir.mockResolvedValue(['x.gpg'])
      hoisted.mockStat.mockRejectedValue(new Error('ENOENT'))
      const c = makeClient()
      const promise = c.audit()
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
      hoisted.captured[0].emitData('StrongP@ss1234!\n')
      hoisted.captured[0].emitClose(0)
      const result = await promise
      expect(result.staleEntries).toEqual([])
      expect(result.storeOk).toBe(true)
    })
  })

  describe('validatePath', () => {
    it('lanza PassError para path con ..', async () => {
      await expect(makeClient().get('../evil')).rejects.toThrow('Invalid entry path')
    })

    it('lanza PassError para path con caracteres no seguros', async () => {
      await expect(makeClient().get('path;ls')).rejects.toThrow('Invalid entry path')
    })

    it('acepta paths seguros', async () => {
      const c = makeClient()
      const promise = c.get('proton/bridge/api-key')
      const entry = hoisted.captured[0]
      entry.emitData('secret\n')
      entry.emitClose(0)
      await      expect(promise).resolves.toBe('secret')
    })
  })
})

// ===========================================================================
// T-PASS-01 — La auditoría es de solo lectura: 0 bytes modificados (F01)
// ===========================================================================

describe('PassClient · T-PASS-01 auditoría de solo lectura', () => {
  const MUTATING_VERBS = ['insert', 'rm', 'mv', 'cp', 'edit', 'generate']

  it('audit() no ejecuta ningún verbo mutante del CLI', async () => {
    hoisted.mockReaddir.mockResolvedValue(['weak.gpg', 'dup.gpg', 'dup2.gpg'])
    hoisted.mockStat.mockResolvedValue({ mtimeMs: Date.now() - 400 * 86_400_000 })
    const c = makeClient()

    const promise = c.audit()
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    // Resolver cada get() en orden: todos débiles + duplicados + stale,
    // es decir, el peor caso posible para el rotationPlan.
    const values = ['abc\n', 'abc\n', 'abc\n']
    for (const value of values) {
      const entry = hoisted.captured[hoisted.captured.length - 1]
      entry.emitData(value)
      entry.emitClose(0)
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    }

    const result = await promise

    // El plan está poblado (hay trabajo que reportar)…
    expect(result.rotationPlan.length).toBeGreaterThan(0)
    expect(result.weakPasswords.length).toBeGreaterThan(0)
    expect(result.staleEntries.length).toBeGreaterThan(0)

    // …y aun así no se ha escrito nada.
    const verbs = hoisted.mockExecFile.mock.calls.map(
      (call) => (call[1] as string[])[0],
    )
    expect(verbs.filter((v) => MUTATING_VERBS.includes(v ?? ''))).toEqual([])
    expect(verbs.every((v) => v === 'show')).toBe(true)
  })

  it('audit() recomienda rotar en el origen, no regenerar en el store', async () => {
    hoisted.mockReaddir.mockResolvedValue(['weak.gpg'])
    hoisted.mockStat.mockResolvedValue({ mtimeMs: Date.now() })
    const c = makeClient()

    const promise = c.audit()
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    hoisted.captured[0].emitData('abc\n')
    hoisted.captured[0].emitClose(0)

    const result = await promise
    const joined = result.recommendations.join(' ')
    expect(joined).not.toContain('AGENT_DRY_RUN=false')
    expect(joined).toContain('NUNCA escribe')
  })
})

// ===========================================================================
// Gaps de branches — cobertura quirúrgica (Lima 87.03% → 95%+)
// ===========================================================================

describe('PassClient — surgical branch coverage', () => {
  describe('execPass stderr vacío fallback', () => {
    it('throws "pass exited with code N" cuando stderr vacío + non-zero exit', async () => {
      const c = makeClient()
      const promise = c.get('proton/bridge')
      const entry = hoisted.captured[0]
      // Importante: NO emitStderr() → forzar el fallback `|| \`pass exited with code ${code}\``
      entry.emitClose(1)
      await expect(promise).rejects.toThrow(PassError)
      await expect(promise).rejects.toThrow('pass exited with code 1')
    })

    it('falls back al código de salida cuando stderr solo tiene whitespace', async () => {
      const c = makeClient()
      const promise = c.get('proton/bridge')
      const entry = hoisted.captured[0]
      entry.emitStderr('   \n  ') // whitespace — trim() → ''
      entry.emitClose(2)
      await expect(promise).rejects.toThrow('pass exited with code 2')
    })
  })

  describe('Constructor DI — exec injectable', () => {
    it('usa custom exec function cuando se inyecta en el constructor', async () => {
      // Tipo explícito para `exec` (no exportado desde src/pass.ts) — fija el
      // signature contra el parámetro del constructor y evita ambigüedad de
      // tipos bajo strict + verbatimModuleSyntax.
      type ExecFn = (
        args: string[],
        opts: { env: NodeJS.ProcessEnv; input?: string },
      ) => Promise<string>
      const customExec = vi.fn<ExecFn>().mockResolvedValue('custom-value')
      const c = new PassClient({ storeDir: '/tmp/x' }, hoisted.silentLog, customExec)
      const result = await c.get('valid/path')
      expect(customExec).toHaveBeenCalledTimes(1)
      expect(customExec).toHaveBeenCalledWith(['show', 'valid/path'], expect.objectContaining({ env: expect.any(Object) }))
      expect(result).toBe('custom-value')
      // El execFile REAL (mockExecFile) no se usa
      expect(hoisted.mockExecFile).not.toHaveBeenCalled()
    })
  })

  describe('non-Error en health()', () => {
    it('health: ok=false cuando readdir rechaza con string', async () => {
      hoisted.mockReaddir.mockRejectedValue('String filesystem error')
      const result = await makeClient().health()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('String filesystem error')
    })
  })

  describe('audit() — catch { continue } en get fallido', () => {
    it('audit: skips entries whose get() fails (continue branch)', async () => {
      hoisted.mockReaddir.mockResolvedValue(['good-a.gpg', 'broken.gpg', 'good-b.gpg'])
      const c = makeClient()
      const promise = c.audit()

      // Esperar a que audit() procese health + list y llame al primer get()
      for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
      expect(hoisted.captured.length).toBe(1)

      // good-a: corto 'a' → débil
      hoisted.captured[0].emitData('a\n')
      hoisted.captured[0].emitClose(0)
      for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
      expect(hoisted.captured.length).toBe(2)

      // broken: get() rechaza con error → branch `catch { continue }`
      hoisted.captured[1].emitError(new Error('Decryption failed'))
      for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
      expect(hoisted.captured.length).toBe(3)

      // good-b: fuerte
      hoisted.captured[2].emitData('StrongP@ss123\n')
      hoisted.captured[2].emitClose(0)

      const result = await promise
      expect(result.storeOk).toBe(true)
      expect(result.totalEntries).toBe(3)
      expect(result.weakPasswords).toContain('good-a')
      // 'broken' fue saltada, no aparece ni en weakPasswords ni en duplicates
      expect(result.weakPasswords.some(p => p.includes('broken'))).toBe(false)
      expect(result.duplicates.some(d => d.includes('broken'))).toBe(false)
    })
  })
})

