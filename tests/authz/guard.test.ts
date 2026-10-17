/**
 * Ramas del interceptor que no se alcanzan desde el servidor completo:
 * modo observación, fallo de auditoría y rechazo al consumir el permiso.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApprovalStore,
  blockedReason,
  guardTool,
  Journal,
  type AuthzPolicyConfig,
} from '../../src/authz/index.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'authz-guard-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const log = { debug: vi.fn(), warn: vi.fn() }

function deps(policy: AuthzPolicyConfig, journalFile: string | null = null) {
  return {
    policy,
    store: new ApprovalStore({ dir: join(dir, 'approvals') }),
    journal: new Journal({ file: journalFile }),
    actor: 'alex',
    log,
  }
}

const ENFORCE: AuthzPolicyConfig = {
  mode: 'enforce',
  allow: ['read'],
  requireApproval: ['write', 'destructive', 'admin'],
}

type Result = {
  isError?: boolean
  content?: { text: string }[]
  structuredContent?: Record<string, unknown>
}

describe('interceptor · ramas', () => {
  it('modo observación deja pasar, aunque lo anota', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const guarded = guardTool(
      'proton_send_email',
      handler,
      deps({ ...ENFORCE, mode: 'observe' }),
    )

    const res = await guarded({ to: ['x@proton.me'] }, { sessionId: 's1' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ ok: true })
    expect(log.warn).toHaveBeenCalledWith(
      'authz observe: se ejecuta sin bloquear',
      expect.objectContaining({ tool: 'proton_send_email' }),
    )
  })

  it('uno destructivo sin auditoría disponible se bloquea', async () => {
    const handler = vi.fn()
    // `dir/journal` es un fichero, así que no se puede crear la ruta del diario.
    writeFileSync(join(dir, 'soy-fichero'), 'x')
    const guarded = guardTool(
      'proton_delete_email',
      handler,
      deps(ENFORCE, join(dir, 'soy-fichero', 'sub', 'j.jsonl')),
    )

    const res = (await guarded({}, { sessionId: 's1' })) as Result

    expect(handler).not.toHaveBeenCalled()
    expect(res.isError).toBe(true)
    expect(res.structuredContent?.['status']).toBe('denied')
    expect(res.structuredContent?.['reason']).toContain('auditoría')
  })

  it('uno de escritura sin auditoría disponible sí puede seguir', async () => {
    writeFileSync(join(dir, 'soy-fichero'), 'x')
    const guarded = guardTool(
      'proton_send_email',
      vi.fn(),
      deps(ENFORCE, join(dir, 'soy-fichero', 'sub', 'j.jsonl')),
    )

    const res = (await guarded({}, { sessionId: 's1' })) as Result

    // Se le pide aprobación con normalidad; lo que no se hace es bloqueo duro.
    expect(res.structuredContent?.['status']).toBe('approval_required')
  })

  it('si el permiso se denegó entre medias, no se ejecuta', async () => {
    const d = deps(ENFORCE)
    const handler = vi.fn()
    const guarded = guardTool('proton_send_email', handler, d)

    const primera = (await guarded({ to: ['x@proton.me'] }, { sessionId: 's1' })) as Result
    const id = primera.structuredContent?.['approvalId'] as string

    // El operador aprueba y luego se arrepiente: la solicitud pasa a denegada.
    d.store.approve(id, 'alex')
    d.store.reject(id)

    const segunda = (await guarded({ to: ['x@proton.me'] }, { sessionId: 's1' })) as Result
    expect(handler).not.toHaveBeenCalled()
    expect(segunda.structuredContent?.['status']).toBe('approval_required')
  })

  it('sin sesión de transporte usa el proceso como ámbito', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const guarded = guardTool('proton_list_emails', handler, deps(ENFORCE))

    // Sin segundo argumento: stdio o CLI.
    await guarded({})

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('una herramienta fuera del catálogo se deniega y no se ejecuta', async () => {
    const handler = vi.fn()
    const guarded = guardTool('proton_no_existe', handler, deps(ENFORCE))

    const res = (await guarded({}, { sessionId: 's1' })) as Result

    expect(handler).not.toHaveBeenCalled()
    expect(res.structuredContent?.['reason']).toContain('fuera del catálogo')
  })

  it('la aprobación aprobada se consume y la llamada se ejecuta', async () => {
    const d = deps(ENFORCE)
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const guarded = guardTool('proton_send_email', handler, d)

    const primera = (await guarded({ to: ['x@proton.me'] }, { sessionId: 's1' })) as Result
    const id = primera.structuredContent?.['approvalId'] as string
    d.store.approve(id, 'alex')

    const res = (await guarded({ to: ['x@proton.me'] }, { sessionId: 's1' })) as Result

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ ok: true })
  })
})

describe('política · plan en seco', () => {
  it('dry_run=true convierte la llamada en lectura', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const guarded = guardTool('proton_drive_organize', handler, deps(ENFORCE))

    await guarded({ dry_run: true }, { sessionId: 's1' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('dry_run=false sigue exigiendo aprobación', async () => {
    const handler = vi.fn()
    const guarded = guardTool('proton_drive_organize', handler, deps(ENFORCE))

    const res = (await guarded({ dry_run: false }, { sessionId: 's1' })) as Result

    expect(handler).not.toHaveBeenCalled()
    expect(res.structuredContent?.['status']).toBe('approval_required')
  })

  it('sin argumentos, la clase declarada manda', async () => {
    const guarded = guardTool('proton_drive_organize', vi.fn(), deps(ENFORCE))
    const res = (await guarded(undefined, { sessionId: 's1' })) as Result
    expect(res.structuredContent?.['status']).toBe('approval_required')
  })
})

describe('interceptor · permiso que no se puede consumir', () => {
  it('si el permiso falla al consumirse, se deniega y avisa', async () => {
    const handler = vi.fn()
    const store = new ApprovalStore({ dir: join(dir, 'approvals') })
    // Almacén simulado: dice que hay permiso, pero al gastarlo lo rechaza.
    // Es una carrera real (otra llamada lo gastó primero); aquí se fuerza.
    const stub = Object.create(store) as ApprovalStore
    stub.findClaimable = () => 'carrera-1'
    stub.claim = () => ({ ok: false, reason: 'already-consumed' })

    const guarded = guardTool('proton_send_email', handler, {
      policy: ENFORCE,
      store: stub,
      journal: new Journal({ file: null }),
      actor: 'alex',
      log,
    })

    const res = (await guarded({ to: ['x@proton.me'] }, { sessionId: 's1' })) as Result

    expect(handler).not.toHaveBeenCalled()
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('already-consumed')
  })
})

describe('blockedReason · cómo decide salir el CLI', () => {
  it('un resultado normal no es un bloqueo', () => {
    expect(blockedReason({ content: [{ text: 'ok' }] })).toBeNull()
    expect(blockedReason(null)).toBeNull()
    expect(blockedReason('texto suelto')).toBeNull()
    expect(blockedReason({ isError: false, content: [] })).toBeNull()
  })

  it('reconoce una aprobación pendiente y nombra la solicitud', () => {
    const motivo = blockedReason({
      isError: true,
      structuredContent: { status: 'approval_required', approvalId: 'abc-123' },
    })
    expect(motivo).toContain('aprobación humana')
    expect(motivo).toContain('abc-123')
  })

  it('si falta el identificador, no inventa uno', () => {
    const motivo = blockedReason({
      isError: true,
      structuredContent: { status: 'approval_required' },
    })
    expect(motivo).toContain('?')
  })

  it('reconoce una denegación y usa su motivo', () => {
    expect(
      blockedReason({
        isError: true,
        structuredContent: { status: 'denied', reason: 'fuera del catálogo' },
      }),
    ).toBe('fuera del catálogo')
  })

  it('una denegación sin motivo cae al texto de la respuesta', () => {
    expect(
      blockedReason({
        isError: true,
        structuredContent: { status: 'denied' },
        content: [{ text: 'Denegado: algo' }],
      }),
    ).toBe('Denegado: algo')
  })

  it('un error sin detalle sigue siendo un bloqueo', () => {
    expect(blockedReason({ isError: true })).toBe('bloqueado')
  })
})

describe('blockedReason · sin ningún detalle', () => {
  it('una denegación sin motivo ni texto sigue siendo un bloqueo', () => {
    expect(
      blockedReason({ isError: true, structuredContent: { status: 'denied' } }),
    ).toBe('denegado')
  })
})
