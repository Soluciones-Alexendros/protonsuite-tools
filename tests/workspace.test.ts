/**
 * T-FS-02 — Sandbox de ficheros (hallazgo F05).
 *
 * Antes, el cliente MCP mandaba `staging_dir` y el servidor lo usaba tal cual:
 * una ruta absoluta o un `../..` bastaban para leer, escribir y MOVER ficheros
 * fuera del sitio previsto.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspacePolicy, WorkspaceViolation } from '../src/workspace.js'

let base: string
let root: string
let policy: WorkspacePolicy

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ws-test-'))
  root = join(base, 'workspace')
  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'sub'), { recursive: true })
  writeFileSync(join(root, 'nota.txt'), 'hola')
  policy = new WorkspacePolicy({ root })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
    return 'sin-error'
  } catch (err) {
    return err instanceof WorkspaceViolation ? err.code : `otro:${String(err)}`
  }
}

describe('dentro del workspace', () => {
  it('acepta la raíz', () => {
    expect(codeOf(() => policy.resolveInside(root))).toBe('sin-error')
  })

  it('acepta rutas relativas y devuelve el camino real', () => {
    const resuelto = policy.resolveInside('sub/nota.txt')
    // Se devuelve el camino REAL (con enlaces resueltos), no el nominal: quien
    // lo use debe trabajar sobre el mismo sitio que se ha validado.
    expect(resuelto.endsWith(join('sub', 'nota.txt'))).toBe(true)
    expect(policy.isInside(resuelto)).toBe(true)
  })

  it('acepta una ruta absoluta que cae dentro', () => {
    expect(codeOf(() => policy.resolveInside(join(root, 'sub')))).toBe('sin-error')
  })

  it('no confunde un nombre que empieza igual', () => {
    // `workspace-otro` NO está dentro de `workspace`: la comparación es por
    // tramos, no por prefijo de texto.
    const vecino = join(base, 'workspace-otro')
    mkdirSync(vecino, { recursive: true })
    expect(codeOf(() => policy.resolveInside(vecino))).toBe('absolute-outside')
  })

  it('resuelve el TOTP de una carpeta que aún no existe', () => {
    expect(codeOf(() => policy.resolveInside('docs/2026'))).toBe('sin-error')
  })
})

describe('fuera del workspace', () => {
  it('rechaza una ruta absoluta de fuera', () => {
    expect(codeOf(() => policy.resolveInside('/etc'))).toBe('absolute-outside')
    expect(codeOf(() => policy.resolveInside('/etc/passwd'))).toBe('absolute-outside')
  })

  it('rechaza el escape con ..', () => {
    expect(codeOf(() => policy.resolveInside('../secreto'))).toBe('traversal-outside')
    expect(codeOf(() => policy.resolveInside('../../../../etc'))).toBe('traversal-outside')
  })

  it('rechaza el recorrido codificado', () => {
    expect(codeOf(() => policy.resolveInside('%2e%2e/etc'))).toBe('encoded-traversal')
    expect(codeOf(() => policy.resolveInside('sub%2f..%2f..'))).toBe('encoded-traversal')
    expect(codeOf(() => policy.resolveInside('%5c..%5cetc'))).toBe('encoded-traversal')
  })

  it('rechaza un byte nulo', () => {
    expect(codeOf(() => policy.resolveInside('nota.txt\0.jpg'))).toBe('nul-byte')
  })

  it('rechaza un enlace que sale del workspace', () => {
    try {
      symlinkSync('/etc', join(root, 'atajo'))
    } catch {
      return // el sistema no permite enlaces; se salta
    }
    expect(codeOf(() => policy.resolveInside('atajo'))).toBe('symlink-escape')
  })

  it('rechaza escribir por un enlace que sale', () => {
    try {
      symlinkSync(base, join(root, 'salida'))
    } catch {
      return
    }
    expect(codeOf(() => policy.resolveInside('salida/nuevo.txt'))).toBe('symlink-escape')
  })

  it('una raíz vacía no se acepta', () => {
    expect(() => new WorkspacePolicy({ root: '   ' })).toThrow(WorkspaceViolation)
  })
})

describe('isInside', () => {
  it('responde sin lanzar', () => {
    expect(policy.isInside('sub')).toBe(true)
    expect(policy.isInside('/etc')).toBe(false)
    expect(policy.isInside('../fuera')).toBe(false)
  })
})
