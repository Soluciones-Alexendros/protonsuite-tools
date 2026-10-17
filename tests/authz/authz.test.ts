/**
 * T-AUTHZ-01 / T-RACE-01 — Núcleo de autorización.
 *
 * Lo que se prueba aquí es lo que hace que esto sea un control y no un adorno:
 * que sin permiso no pasa nada, que un permiso no sirve dos veces, que no sirve
 * para otra cosa distinta de la aprobada y que dos llamadas a la vez no pueden
 * gastarlo las dos.
 */
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ApprovalStore,
  bindingOf,
  decide,
  DEFAULT_POLICY,
  redactedPreview,
  TOOL_EFFECTS,
  type AuthzPolicyConfig,
} from '../../src/authz/index.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'authz-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('política', () => {
  const input = { toolId: 'proton_send_email', actor: 'alex', sessionId: 's1' }

  it('deja pasar la lectura sin aprobación', () => {
    const r = decide({ ...input, toolId: 'proton_list_emails' })
    expect(r.decision).toBe('allow')
  })

  it('exige aprobación para escribir, destruir y administrar', () => {
    expect(decide(input).decision).toBe('require_approval') // write
    expect(decide({ ...input, toolId: 'proton_delete_email' }).decision).toBe(
      'require_approval',
    ) // destructive
    expect(decide({ ...input, toolId: 'proton_bridge_login' }).decision).toBe(
      'require_approval',
    ) // admin
  })

  it('deniega una herramienta que no está en el catálogo', () => {
    const r = decide({ ...input, toolId: 'proton_inventada_por_el_atacante' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('fuera del catálogo')
  })

  it('deniega por defecto lo que no está autorizado explícitamente', () => {
    const soloLectura: AuthzPolicyConfig = {
      mode: 'enforce',
      allow: ['read'],
      requireApproval: [],
    }
    expect(decide(input, soloLectura).decision).toBe('deny')
  })

  it('el operador puede autorizar una clase entera', () => {
    const confiado: AuthzPolicyConfig = {
      mode: 'enforce',
      allow: ['read', 'write'],
      requireApproval: ['destructive', 'admin'],
    }
    expect(decide(input, confiado).decision).toBe('allow')
    expect(decide({ ...input, toolId: 'proton_delete_email' }, confiado).decision).toBe(
      'require_approval',
    )
  })

  it('el modo por defecto es aplicar la política, no observar', () => {
    expect(DEFAULT_POLICY.mode).toBe('enforce')
    expect(DEFAULT_POLICY.allow).toEqual(['read'])
  })
})

describe('catálogo', () => {
  it('declara las herramientas de correo más peligrosas como mutativas', () => {
    expect(TOOL_EFFECTS['proton_delete_email']?.effectClass).toBe('destructive')
    expect(TOOL_EFFECTS['proton_send_email']?.effectClass).toBe('write')
  })

  it('corrige las anotaciones que estaban mal (F43)', () => {
    expect(TOOL_EFFECTS['proton_calendar_create_event']?.effectClass).not.toBe('read')
    expect(TOOL_EFFECTS['proton_drive_copy']?.effectClass).not.toBe('read')
  })

  it('cada entrada explica por qué tiene esa clase', () => {
    for (const [tool, effect] of Object.entries(TOOL_EFFECTS)) {
      expect(effect.reason.length, `${tool} sin motivo`).toBeGreaterThan(10)
    }
  })
})

describe('vista previa de argumentos', () => {
  it('tacha los campos sensibles', () => {
    const preview = redactedPreview({
      path: 'proton/bridge',
      secret: 'super-secreto',
      password: 'otra',
      length: 24,
    })
    expect(preview['secret']).toBe('[redactado]')
    expect(preview['password']).toBe('[redactado]')
    expect(preview['path']).toBe('proton/bridge')
    expect(preview['length']).toBe(24)
  })
})

describe('almacén de aprobaciones', () => {
  const reqInput = {
    toolId: 'proton_send_email',
    effectClass: 'write' as const,
    scopes: ['mailbox'],
    actor: 'alex',
    sessionId: 's1',
    args: { to: ['destino@proton.me'], subject: 'hola', body: 'texto' },
  }

  it('sin aprobación, el permiso no se concede', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    const claim = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: reqInput.args,
      actor: 'alex',
      sessionId: 's1',
    })
    expect(claim).toEqual({ ok: false, reason: 'not-approved' })
  })

  it('con aprobación, se concede una vez', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    store.approve(req.id, 'alex')

    const first = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: reqInput.args,
      actor: 'alex',
      sessionId: 's1',
    })
    expect(first.ok).toBe(true)

    const second = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: reqInput.args,
      actor: 'alex',
      sessionId: 's1',
    })
    expect(second).toEqual({ ok: false, reason: 'already-consumed' })
  })

  it('cambiar un destinatario invalida la aprobación', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    store.approve(req.id, 'alex')

    const claim = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: { ...reqInput.args, to: ['otro@proton.me'] },
      actor: 'alex',
      sessionId: 's1',
    })
    expect(claim).toEqual({ ok: false, reason: 'binding-mismatch' })
  })

  it('cambiar un byte del cuerpo invalida la aprobación', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    store.approve(req.id, 'alex')

    const claim = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: { ...reqInput.args, body: 'textO' },
      actor: 'alex',
      sessionId: 's1',
    })
    expect(claim).toEqual({ ok: false, reason: 'binding-mismatch' })
  })

  it('no sirve desde otra sesión', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    store.approve(req.id, 'alex')

    const claim = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: reqInput.args,
      actor: 'alex',
      sessionId: 's2',
    })
    expect(claim).toEqual({ ok: false, reason: 'session-mismatch' })
  })

  it('no sirve para otra herramienta', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    store.approve(req.id, 'alex')

    const claim = store.claim(req.id, {
      toolId: 'proton_delete_email',
      args: reqInput.args,
      actor: 'alex',
      sessionId: 's1',
    })
    expect(claim).toEqual({ ok: false, reason: 'binding-mismatch' })
  })

  it('caduca', async () => {
    let t = new Date('2026-10-17T10:00:00Z')
    const store = new ApprovalStore({ dir, ttlMs: 1000, now: () => t })
    const req = await store.createRequest(reqInput)
    store.approve(req.id, 'alex')

    t = new Date('2026-10-17T10:00:02Z')
    const claim = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: reqInput.args,
      actor: 'alex',
      sessionId: 's1',
    })
    expect(claim).toEqual({ ok: false, reason: 'expired' })
  })

  it('una solicitud denegada no se puede consumir', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    store.reject(req.id)

    const claim = store.claim(req.id, {
      toolId: reqInput.toolId,
      args: reqInput.args,
      actor: 'alex',
      sessionId: 's1',
    })
    expect(claim).toEqual({ ok: false, reason: 'rejected' })
  })

  it('T-RACE-01: dos llamadas a la vez, como máximo una gana', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest(reqInput)
    store.approve(req.id, 'alex')

    const intento = () =>
      store.claim(req.id, {
        toolId: reqInput.toolId,
        args: reqInput.args,
        actor: 'alex',
        sessionId: 's1',
      })

    const resultados = await Promise.all([
      Promise.resolve().then(intento),
      Promise.resolve().then(intento),
      Promise.resolve().then(intento),
    ])

    expect(resultados.filter((r) => r.ok)).toHaveLength(1)
    expect(resultados.filter((r) => !r.ok)).toHaveLength(2)
    expect(readdirSync(join(dir, 'consumed'))).toHaveLength(1)
  })

  it('no guarda secretos en disco', async () => {
    const store = new ApprovalStore({ dir })
    const req = await store.createRequest({
      ...reqInput,
      toolId: 'proton_pass_insert',
      args: { path: 'proton/bridge', secret: 'NO-DEBE-APARECER' },
    })

    expect(JSON.stringify(req)).not.toContain('NO-DEBE-APARECER')
    const enDisco = readFileSync(join(dir, 'pending', `${req.id}.json`), 'utf8')
    expect(enDisco).not.toContain('NO-DEBE-APARECER')
    expect(enDisco).toContain('[redactado]')
    // La huella sí está: es lo que ata la aprobación a esos argumentos exactos.
    expect(enDisco).toContain(bindingOf('proton_pass_insert', {
      path: 'proton/bridge',
      secret: 'NO-DEBE-APARECER',
    }))
  })

  it('la huella no depende del orden de las claves', () => {
    expect(bindingOf('t', { a: 1, b: 2 })).toBe(bindingOf('t', { b: 2, a: 1 }))
    expect(bindingOf('t', { a: 1 })).not.toBe(bindingOf('t', { a: 2 }))
  })

  it('una solicitud desconocida no se puede consumir', () => {
    const store = new ApprovalStore({ dir })
    expect(
      store.claim('00000000-0000-0000-0000-000000000000', {
        toolId: 'proton_send_email',
        args: {},
        actor: 'alex',
        sessionId: 's1',
      }),
    ).toEqual({ ok: false, reason: 'unknown-request' })
  })
})
