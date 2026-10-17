/**
 * T-FS-03 (parcial) — `moveNoClobber` bajo fallo: mapeo de errores del
 * filesystem. Estas ramas solo se alcanzan provocando el fallo (inyección de
 * faultos), porque 'EXDEV' o un error genérico no ocurren en un FS real de
 * pruebas.
 */
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  linkSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DestinationExistsError, moveNoClobber } from '../src/drive-utils.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    linkSync: vi.fn(actual.linkSync),
    copyFileSync: vi.fn(actual.copyFileSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  }
})

const TMP = '/tmp/test-drive-utils-noclobber'

const errnoError = (code: string) =>
  Object.assign(new Error(code), { code }) as NodeJS.ErrnoException

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(resolve(TMP, 'dst'), { recursive: true })
  vi.mocked(linkSync).mockClear()
  vi.mocked(copyFileSync).mockClear()
  vi.mocked(unlinkSync).mockClear()
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('moveNoClobber · mapeo de errores', () => {
  it('propaga un error distinto de EEXIST/EXDEV sin disfrazarlo', () => {
    vi.mocked(linkSync).mockImplementationOnce(() => {
      throw errnoError('ENOENT')
    })
    expect(() => moveNoClobber(resolve(TMP, 'a.txt'), resolve(TMP, 'dst/a.txt'))).toThrow(
      /ENOENT/,
    )
    expect(vi.mocked(copyFileSync)).not.toHaveBeenCalled()
  })

  it('con EXDEV cae a copyFile exclusivo y borra el origen', () => {
    writeFileSync(resolve(TMP, 'a.txt'), 'datos')
    vi.mocked(linkSync).mockImplementationOnce(() => {
      throw errnoError('EXDEV')
    })

    moveNoClobber(resolve(TMP, 'a.txt'), resolve(TMP, 'dst/a.txt'))

    expect(vi.mocked(copyFileSync)).toHaveBeenCalledTimes(1)
    const [, , flag] = vi.mocked(copyFileSync).mock.calls[0] as [string, string, number]
    expect(flag).toBe(1) // COPYFILE_EXCL
    expect(existsSync(resolve(TMP, 'dst/a.txt'))).toBe(true)
    expect(existsSync(resolve(TMP, 'a.txt'))).toBe(false)
    expect(vi.mocked(unlinkSync)).toHaveBeenCalled()
  })

  it('si el destino aparece durante el fallback EXDEV, no sobrescribe', () => {
    writeFileSync(resolve(TMP, 'a.txt'), 'ORIGEN')
    vi.mocked(linkSync).mockImplementationOnce(() => {
      throw errnoError('EXDEV')
    })
    vi.mocked(copyFileSync).mockImplementationOnce(() => {
      throw errnoError('EEXIST')
    })

    expect(() =>
      moveNoClobber(resolve(TMP, 'a.txt'), resolve(TMP, 'dst/a.txt')),
    ).toThrow(DestinationExistsError)
    expect(existsSync(resolve(TMP, 'a.txt'))).toBe(true)
  })

  it('un error distinto durante el fallback EXDEV se propaga tal cual', () => {
    vi.mocked(linkSync).mockImplementationOnce(() => {
      throw errnoError('EXDEV')
    })
    vi.mocked(copyFileSync).mockImplementationOnce(() => {
      throw errnoError('ENOSPC')
    })

    expect(() => moveNoClobber(resolve(TMP, 'a.txt'), resolve(TMP, 'dst/a.txt'))).toThrow(
      /ENOSPC/,
    )
  })

  it('en el camino real (sin inyección) mueve sin sobrescribir', () => {
    writeFileSync(resolve(TMP, 'a.txt'), 'real')
    moveNoClobber(resolve(TMP, 'a.txt'), resolve(TMP, 'dst/a.txt'))
    expect(existsSync(resolve(TMP, 'dst/a.txt'))).toBe(true)
  })
})
