/**
 * Tests para src/drive.ts (60.17% → objetivo ~95%).
 *
 * DriveClient.execCli usa callback API de execFile:
 *   execFile(bin, args, opts, (err, stdout, stderr) => {...})
 * El mock llama al callback con setNextResult / setNextError.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DriveClient } from '../src/drive.js'

const hoisted = vi.hoisted(() => {
  const silentLog = { debug: vi.fn(), info: vi.fn(), error: vi.fn() }
  let nextStdout: string | undefined
  let nextError: Error | undefined

  const mockExecFile = vi.fn((_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (nextError) {
      const e = nextError
      nextError = undefined
      setImmediate(() => { cb(e, '', ''); })
    } else {
      const out = nextStdout ?? ''
      nextStdout = undefined
      setImmediate(() => { cb(null, out, ''); })
    }
    return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, stdin: { write: vi.fn(), end: vi.fn() }, on: vi.fn() }
  })

  const mockExecFileSync = vi.fn()
  const mockExistsSync = vi.fn()
  const mockMkdirSync = vi.fn()
  const mockReaddirSync = vi.fn()
  const mockStatSync = vi.fn()
  const mockReaddir = vi.fn()
  const mockStat = vi.fn()

  return {
    silentLog, mockExecFile, mockExecFileSync, mockExistsSync, mockMkdirSync, mockReaddirSync, mockStatSync, mockReaddir, mockStat,
    setNextResult: (stdout: string) => { nextStdout = stdout },
    setNextError: (err: Error) => { nextError = err },
  }
})

vi.mock('node:child_process', () => ({
  execFile: hoisted.mockExecFile,
  execFileSync: hoisted.mockExecFileSync,
}))
vi.mock('node:fs', () => ({
  existsSync: hoisted.mockExistsSync,
  mkdirSync: hoisted.mockMkdirSync,
  readdirSync: hoisted.mockReaddirSync,
  statSync: hoisted.mockStatSync,
  readFileSync: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({
  readdir: hoisted.mockReaddir,
  stat: hoisted.mockStat,
  // El recorrido acotado usa lstat a propósito: no sigue enlaces (F25). El mock
  // responde igual que stat porque lo que se prueba aquí es el recuento.
  lstat: hoisted.mockStat,
}))

beforeEach(() => { vi.clearAllMocks() })

function makeClient() {
  return new DriveClient(
    { cliBin: '/usr/bin/proton-drive', stagingDir: '/tmp/staging', obsoleteExtensions: ['.doc', '.xls'] },
    hoisted.silentLog,
  )
}

describe('DriveClient', () => {
  describe('stagingDir', () => {
    it('expande ~ al HOME', () => {
      const orig = process.env.HOME
      process.env.HOME = '/home/user'
      const c = new DriveClient({ cliBin: 'pd', stagingDir: '~/drive', obsoleteExtensions: [] }, hoisted.silentLog)
      expect(c.stagingDir).toBe('/home/user/drive')
      process.env.HOME = orig
    })
    it('fallback a vacío cuando HOME no está definido', () => {
      const orig = process.env.HOME
      delete process.env.HOME
      const c = new DriveClient({ cliBin: 'pd', stagingDir: '~/drive', obsoleteExtensions: [] }, hoisted.silentLog)
      expect(c.stagingDir).not.toContain('~')
      process.env.HOME = orig
    })
  })

  describe('checkDeps', () => {
    it('devuelve ok=true con version', () => {
      hoisted.mockExecFileSync.mockReturnValue('proton-drive 1.0.0\n')
      const r = makeClient().checkDeps()
      expect(r.ok).toBe(true)
      expect(r.version).toBe('proton-drive 1.0.0')
    })
    it('devuelve ok=false cuando lanza', () => {
      hoisted.mockExecFileSync.mockImplementation(() => { throw new Error('ENOENT') })
      const r = makeClient().checkDeps()
      expect(r.ok).toBe(false)
      expect(r.error).toContain('proton-drive not found')
    })
  })

  describe('execCli', () => {
    it('resuelve con stdout', async () => {
      hoisted.setNextResult('1.0.0\n')
      const r = await makeClient().execCli(['--version'])
      expect(r.stdout).toBe('1.0.0\n')
    })
    it('rechaza con error', async () => {
      hoisted.setNextError(new Error('EPERM'))
      await expect(makeClient().execCli(['bad'])).rejects.toThrow('proton-drive error')
    })
  })

  describe('listFiles', () => {
    it('parsea JSON array de stdout', async () => {
      hoisted.setNextResult(JSON.stringify([{ name: 'a.txt', size: 100 }, { name: 'b.txt' }]))
      const r = await makeClient().listFiles('/path')
      expect(r.ok).toBe(true)
      expect(r.files).toHaveLength(2)
    })
    it('parsea objeto con key "files"', async () => {
      hoisted.setNextResult(JSON.stringify({ files: [{ name: 'x.txt' }] }))
      const r = await makeClient().listFiles('/path')
      expect(r.ok).toBe(true)
      expect(r.files).toHaveLength(1)
    })
    it('parsea objeto con key "entries"', async () => {
      hoisted.setNextResult(JSON.stringify({ entries: [{ name: 'y.txt' }] }))
      const r = await makeClient().listFiles('/path')
      expect(r.ok).toBe(true)
      expect(r.files).toHaveLength(1)
    })
    it('devuelve vacío para formato inesperado', async () => {
      hoisted.setNextResult(JSON.stringify({ unexpected: true }))
      const r = await makeClient().listFiles('/path')
      expect(r.ok).toBe(true)
      expect(r.files).toEqual([])
    })
    it('devuelve ok=false cuando execCli lanza', async () => {
      hoisted.setNextError(new Error('timeout'))
      const r = await makeClient().listFiles('/bad')
      expect(r.ok).toBe(false)
      expect(r.error).toBeTruthy()
    })
  })

  describe('download', () => {
    it('descarga a staging por defecto', async () => {
      hoisted.mockExistsSync.mockReturnValue(true)
      hoisted.setNextResult('')
      const r = await makeClient().download('/remote')
      expect(r.ok).toBe(true)
      expect(r.localPath).toBe('/tmp/staging')
    })
    it('crea staging dir si no existe', async () => {
      hoisted.mockExistsSync.mockReturnValue(false)
      hoisted.setNextResult('')
      const r = await makeClient().download('/remote', '/custom')
      expect(r.ok).toBe(true)
      expect(hoisted.mockMkdirSync).toHaveBeenCalledWith('/custom', { recursive: true })
    })
    it('devuelve error cuando falla', async () => {
      hoisted.mockExistsSync.mockReturnValue(true)
      hoisted.setNextError(new Error('download failed'))
      const r = await makeClient().download('/bad')
      expect(r.ok).toBe(false)
      expect(r.error).toBeTruthy()
    })
  })

  describe('upload', () => {
    it('sube a /my-files por defecto', async () => {
      hoisted.setNextResult('')
      const r = await makeClient().upload()
      expect(r.ok).toBe(true)
      expect(r.remotePath).toBe('/my-files')
    })
    it('devuelve error cuando falla', async () => {
      hoisted.setNextError(new Error('upload failed'))
      const r = await makeClient().upload()
      expect(r.ok).toBe(false)
    })
  })

  describe('share', () => {
    it('invita usuario y devuelve ok', async () => {
      hoisted.setNextResult('')
      const r = await makeClient().share('/path', 'user@test.com')
      expect(r.ok).toBe(true)
      expect(r.userEmail).toBe('user@test.com')
    })
    it('devuelve error cuando falla', async () => {
      hoisted.setNextError(new Error('share failed'))
      const r = await makeClient().share('/path', 'u@t.com')
      expect(r.ok).toBe(false)
    })
  })

  describe('status', () => {
    it('staging existente con file count y auth ok', async () => {
      hoisted.mockExistsSync.mockReturnValue(true)
      hoisted.mockReaddir.mockImplementation(async (dir: string) => {
        if (dir === '/tmp/staging') return ['f1.txt', 'sub']
        if (dir === '/tmp/staging/sub') return ['f2.txt']
        return []
      })
      hoisted.mockStat.mockImplementation(async (p: string) => ({
        isDirectory: () => p.endsWith('/sub'),
        // El recorrido acotado pregunta primero si es un enlace (F25).
        isSymbolicLink: () => false,
        dev: 1,
        ino: p.length,
        size: 100,
        mtime: new Date(),
      }))
      hoisted.setNextResult('')
      const r = await makeClient().status()
      expect(r.stagingExists).toBe(true)
      expect(r.stagingFiles).toBe(2)
      expect(r.authenticated).toBe(true)
      expect(r.ok).toBe(true)
    })
    it('salta archivos con stat fallido (catch vacío)', async () => {
      hoisted.mockExistsSync.mockReturnValue(true)
      hoisted.mockReaddir.mockResolvedValue(['bad.txt'])
      hoisted.mockStat.mockRejectedValue(new Error('EACCES'))
      hoisted.setNextResult('')
      const r = await makeClient().status()
      expect(r.stagingExists).toBe(true)
      expect(r.stagingFiles).toBe(0)
      expect(r.authenticated).toBe(true)
    })
    it('authenticated=false cuando auth falla', async () => {
      hoisted.mockExistsSync.mockReturnValue(false)
      hoisted.setNextError(new Error('auth failed'))
      const r = await makeClient().status()
      expect(r.authenticated).toBe(false)
      expect(r.stagingExists).toBe(false)
    })
  })

  describe('moveFiles', () => {
    it('mueve y devuelve ok', async () => {
      hoisted.setNextResult('')
      const r = await makeClient().moveFiles('/a', '/b')
      expect(r.ok).toBe(true)
    })
    it('error cuando falla', async () => {
      hoisted.setNextError(new Error('move failed'))
      const r = await makeClient().moveFiles('/a', '/b')
      expect(r.ok).toBe(false)
    })
  })

  describe('copyFiles', () => {
    it('copia y devuelve ok', async () => {
      hoisted.setNextResult('')
      expect((await makeClient().copyFiles('/s', '/d')).ok).toBe(true)
    })
    it('error cuando falla', async () => {
      hoisted.setNextError(new Error('copy failed'))
      const r = await makeClient().copyFiles('/s', '/d')
      expect(r.ok).toBe(false)
      expect(r.error).toContain('copy failed')
    })
  })

  describe('mkdir', () => {
    it('crea directorio y devuelve ok', async () => {
      hoisted.setNextResult('')
      expect((await makeClient().mkdir('/new')).ok).toBe(true)
    })
    it('error cuando falla', async () => {
      hoisted.setNextError(new Error('mkdir failed'))
      const r = await makeClient().mkdir('/new')
      expect(r.ok).toBe(false)
      expect(r.error).toContain('mkdir failed')
    })
  })

  describe('removeFiles', () => {
    it('elimina y devuelve ok', async () => {
      hoisted.setNextResult('')
      expect((await makeClient().removeFiles('/old')).ok).toBe(true)
    })
    it('error cuando falla', async () => {
      hoisted.setNextError(new Error('rm failed'))
      const r = await makeClient().removeFiles('/old')
      expect(r.ok).toBe(false)
      expect(r.error).toContain('rm failed')
    })
  })
})
