/**
 * T-FS-03 — Recorrido y hash acotados (hallazgo F25).
 *
 * Antes, `walkDir` usaba `stat`, que SIGUE los enlaces: un enlace a `/` o a un
 * ancestro provocaba un recorrido infinito o fuera del sitio previsto, y no
 * había tope de profundidad, ficheros ni bytes. `hashFile` leía el fichero
 * entero en memoria, de forma síncrona.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashFile, walkDir } from '../src/drive-utils.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'walk-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const recoge = async (
  limites = {},
): Promise<{ nombres: string[]; stats: Awaited<ReturnType<typeof walkDir>> }> => {
  const nombres: string[] = []
  const stats = await walkDir(
    dir,
    (entry) => {
      nombres.push(entry)
    },
    undefined,
    limites,
  )
  return { nombres, stats }
}

describe('recorrido acotado', () => {
  it('recorre lo normal y cuenta ficheros y bytes', async () => {
    writeFileSync(join(dir, 'a.txt'), 'uno')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'b.txt'), 'dos')

    const { nombres, stats } = await recoge()
    expect(nombres.sort()).toEqual(['a.txt', 'b.txt'])
    expect(stats.files).toBe(2)
    expect(stats.bytes).toBe(6)
    expect(stats.truncatedBy).toBeUndefined()
  })

  it('NO sigue los enlaces a carpetas (antes se salía y podía entrar en bucle)', async () => {
    writeFileSync(join(dir, 'a.txt'), 'uno')
    const fuera = mkdtempSync(join(tmpdir(), 'fuera-'))
    writeFileSync(join(fuera, 'secreto.txt'), 'no debería verse')
    try {
      symlinkSync(fuera, join(dir, 'atajo'))
    } catch {
      rmSync(fuera, { recursive: true, force: true })
      return
    }

    const { nombres } = await recoge()
    expect(nombres).toContain('atajo')
    expect(nombres).not.toContain('secreto.txt')

    rmSync(fuera, { recursive: true, force: true })
  })

  it('no se cuelga con un enlace que apunta a un ancestro', async () => {
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'a.txt'), 'x')
    try {
      symlinkSync(dir, join(dir, 'sub', 'bucle'))
    } catch {
      return
    }

    // Si siguiera enlaces, esto no terminaría.
    const { stats } = await recoge()
    expect(stats.files).toBeGreaterThanOrEqual(1)
  })

  it('corta por profundidad y lo dice', async () => {
    let actual = dir
    for (let i = 0; i < 6; i++) {
      actual = join(actual, `n${i}`)
    }
    mkdirSync(actual, { recursive: true })
    writeFileSync(join(actual, 'fondo.txt'), 'x')

    const { stats } = await recoge({ maxDepth: 2 })
    expect(stats.truncatedBy).toBe('max-depth')
  })

  it('corta por número de ficheros y lo dice', async () => {
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(dir, `f${i}.txt`), 'x')
    }

    const { stats } = await recoge({ maxFiles: 5 })
    expect(stats.truncatedBy).toBe('max-files')
    expect(stats.files).toBe(5)
  })

  it('corta por bytes y lo dice', async () => {
    writeFileSync(join(dir, 'grande.bin'), Buffer.alloc(2048))

    const { stats } = await recoge({ maxBytes: 1024 })
    expect(stats.truncatedBy).toBe('max-bytes')
    expect(stats.bytes).toBe(0)
  })

  it('se puede cancelar', async () => {
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(dir, `f${i}.txt`), 'x')
    }
    const controller = new AbortController()
    controller.abort()

    const { stats } = await recoge({ signal: controller.signal })
    expect(stats.truncatedBy).toBe('aborted')
  })
})

describe('hash en streaming', () => {
  it('da el mismo resultado que el contenido', async () => {
    const ruta = join(dir, 'x.txt')
    writeFileSync(ruta, 'contenido conocido')
    const h = await hashFile(ruta)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashFile(ruta)).toBe(h)
  })

  it('con un fichero grande no carga todo en memoria', async () => {
    const ruta = join(dir, 'grande.bin')
    writeFileSync(ruta, Buffer.alloc(8 * 1024 * 1024, 7))

    const antes = process.memoryUsage().heapUsed
    const h = await hashFile(ruta)
    const despues = process.memoryUsage().heapUsed

    expect(h).toMatch(/^[0-9a-f]{64}$/)
    // En streaming el consumo no crece con el tamaño del fichero. El margen es
    // amplio a propósito, para no volverlo frágil.
    expect(despues - antes).toBeLessThan(4 * 1024 * 1024)
  })
})

describe('recorrido · errores y bordes', () => {
  it('avisa cuando una carpeta no se puede leer, en vez de reventar', async () => {
    const { chmodSync } = await import('node:fs')
    const cerrada = join(dir, 'cerrada')
    mkdirSync(cerrada)
    writeFileSync(join(cerrada, 'dentro.txt'), 'x')
    chmodSync(cerrada, 0o000)

    const errores: string[] = []
    const nombres: string[] = []
    await walkDir(
      dir,
      (entry) => {
        nombres.push(entry)
      },
      (full) => {
        errores.push(full)
      },
    )

    chmodSync(cerrada, 0o755)
    // Si el proceso corre como root, los permisos no aplican: no se exige nada.
    if (process.getuid?.() !== 0) {
      expect(errores.some((e) => e.includes('cerrada'))).toBe(true)
    }
  })

  it('un enlace también cuenta para el tope de ficheros', async () => {
    try {
      symlinkSync(join(dir, 'no-existe'), join(dir, 'e1'))
      symlinkSync(join(dir, 'no-existe'), join(dir, 'e2'))
    } catch {
      return
    }

    const stats = await walkDir(dir, () => undefined, undefined, {
      maxFiles: 1,
    })
    expect(stats.truncatedBy).toBe('max-files')
    expect(stats.files).toBe(1)
  })
})
