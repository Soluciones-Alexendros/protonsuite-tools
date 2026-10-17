/**
 * Cobertura del resto del núcleo de autorización: auditoría, ayudantes de
 * clase de efecto y caminos de error del almacén.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ApprovalStore,
  catalogedTools,
  EFFECT_CLASSES,
  effectClassOfTool,
  hintsFor,
  isEffectClass,
  isMutating,
  Journal,
} from '../../src/authz/index.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'authz-extra-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('clases de efecto', () => {
  it('reconoce solo las clases declaradas', () => {
    for (const c of EFFECT_CLASSES) expect(isEffectClass(c)).toBe(true)
    expect(isEffectClass('peligrosa')).toBe(false)
    expect(isEffectClass('')).toBe(false)
  })

  it('solo la lectura no muta', () => {
    expect(isMutating('read')).toBe(false)
    expect(isMutating('write')).toBe(true)
    expect(isMutating('destructive')).toBe(true)
    expect(isMutating('admin')).toBe(true)
  })

  it('deriva los hints de la clase, no al revés', () => {
    expect(hintsFor('read')).toEqual({ readOnlyHint: true, destructiveHint: false })
    expect(hintsFor('write')).toEqual({ readOnlyHint: false, destructiveHint: false })
    expect(hintsFor('destructive')).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    })
    expect(hintsFor('admin')).toEqual({ readOnlyHint: false, destructiveHint: true })
  })
})

describe('catálogo · ayudantes', () => {
  it('lista las herramientas ordenadas', () => {
    const tools = catalogedTools()
    expect(tools.length).toBeGreaterThan(40)
    expect([...tools].sort()).toEqual(tools)
  })

  it('devuelve la clase de una herramienta conocida y nada si no lo es', () => {
    expect(effectClassOfTool('proton_delete_email')).toBe('destructive')
    expect(effectClassOfTool('proton_no_existe')).toBeUndefined()
  })
})

describe('auditoría', () => {
  const entry = {
    correlationId: 'c-1',
    toolId: 'proton_send_email',
    effectClass: 'write' as const,
    decision: 'require_approval' as const,
    outcome: 'pending-approval' as const,
    actor: 'alex',
    sessionId: 's1',
    reason: 'exige aprobación',
  }

  it('escribe una línea por intento, con marca de tiempo', () => {
    const file = join(dir, 'journal.jsonl')
    const journal = new Journal({ file, now: () => new Date('2026-10-17T10:00:00Z') })

    expect(journal.write(entry)).toBe(true)
    expect(journal.write({ ...entry, correlationId: 'c-2' })).toBe(true)

    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(first['at']).toBe('2026-10-17T10:00:00.000Z')
    expect(first['correlationId']).toBe('c-1')
  })

  it('sin fichero configurado no hace nada y no falla', () => {
    const journal = new Journal({ file: null })
    expect(journal.write(entry)).toBe(true)
  })

  it('si no puede escribir, lo dice en vez de fingir éxito', () => {
    // `dir/notadir` es un fichero: crear `dir/notadir/sub/journal.jsonl` falla.
    writeFileSync(join(dir, 'notadir'), 'x')
    const journal = new Journal({ file: join(dir, 'notadir', 'sub', 'journal.jsonl') })
    expect(journal.write(entry)).toBe(false)
  })

  it('no escribe valores de secretos porque no recibe argumentos', () => {
    const file = join(dir, 'journal.jsonl')
    new Journal({ file }).write(entry)
    const content = readFileSync(file, 'utf8')
    expect(content).not.toContain('secret')
  })
})

describe('almacén · caminos de error', () => {
  it('avisa si el almacén no se puede usar', () => {
    const asFile = join(dir, 'soy-un-fichero')
    writeFileSync(asFile, 'x')
    const store = new ApprovalStore({ dir: asFile })

    expect(store.isAvailable()).toBe(false)
    expect(
      store.claim('cualquiera', {
        toolId: 'proton_send_email',
        args: {},
        actor: 'a',
        sessionId: 's',
      }),
    ).toEqual({ ok: false, reason: 'store-unavailable' })
  })

  it('no se puede aprobar una solicitud que no existe', () => {
    const store = new ApprovalStore({ dir })
    expect(() => store.approve('inexistente', 'alex')).toThrow(/desconocida/)
  })

  it('no se puede denegar una solicitud que no existe', () => {
    const store = new ApprovalStore({ dir })
    expect(() => store.reject('inexistente')).toThrow(/desconocida/)
  })

  it('lista y lee las solicitudes pendientes', () => {
    const store = new ApprovalStore({ dir })
    expect(store.pendingIds()).toEqual([])

    const req = store.createRequest({
      toolId: 'proton_send_email',
      effectClass: 'write',
      scopes: ['mailbox'],
      actor: 'alex',
      sessionId: 's1',
      args: { to: ['x@proton.me'] },
    })

    expect(store.pendingIds()).toEqual([req.id])
    const leida = store.readPending(req.id)
    expect(leida?.toolId).toBe('proton_send_email')
    expect(store.readPending('otra')).toBeNull()
  })
})
