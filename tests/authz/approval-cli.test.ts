/**
 * Comandos de aprobación: lo que el operador teclea en su terminal.
 *
 * Se prueban aquí, con las salidas capturadas, porque son el único canal que
 * puede conceder permiso. Si esto se rompe, no hay forma de autorizar nada.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApprovalStore, runApprovalCommand } from '../../src/authz/index.js'

let dir: string
let salida: string[]
let errores: string[]

const io = {
  out: (t: string) => salida.push(t),
  err: (t: string) => errores.push(t),
}

const texto = () => salida.join('')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'authz-cli-'))
  salida = []
  errores = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function conSolicitud(): { store: ApprovalStore; id: string } {
  const store = new ApprovalStore({ dir })
  const req = store.createRequest({
    toolId: 'proton_send_email',
    effectClass: 'write',
    scopes: ['mailbox'],
    actor: 'alex',
    sessionId: 's1',
    args: { to: ['jefa@proton.me'], subject: 'Informe', secret: 'no-debe-salir' },
  })
  return { store, id: req.id }
}

describe('comandos de aprobación', () => {
  it('sin nada pendiente lo dice y sale bien', () => {
    const store = new ApprovalStore({ dir })
    expect(runApprovalCommand('pending', undefined, store, io)).toBe(0)
    expect(texto()).toContain('No hay operaciones esperando aprobación')
  })

  it('lista lo pendiente sin enseñar secretos', () => {
    const { store, id } = conSolicitud()
    expect(runApprovalCommand('pending', undefined, store, io)).toBe(0)

    expect(texto()).toContain(id)
    expect(texto()).toContain('proton_send_email')
    expect(texto()).toContain('jefa@proton.me')
    expect(texto()).toContain('[redactado]')
    expect(texto()).not.toContain('no-debe-salir')
  })

  it('aprueba y deja el permiso listo', () => {
    const { store, id } = conSolicitud()
    expect(runApprovalCommand('approve', id, store, io, 'alex')).toBe(0)
    expect(texto()).toContain('Aprobada')

    // El permiso existe: una llamada que encaje lo puede gastar.
    expect(
      store.findClaimable('binding-que-no-encaja', 'alex', 's1'),
    ).toBeNull()
    expect(store.pendingIds()).toEqual([id])
  })

  it('deniega y la solicitud deja de poder consumirse', () => {
    const { store, id } = conSolicitud()
    expect(runApprovalCommand('reject', id, store, io)).toBe(0)
    expect(texto()).toContain('Denegada')
    expect(store.pendingIds()).toEqual([])
  })

  it('avisa si falta el identificador', () => {
    const { store } = conSolicitud()
    expect(runApprovalCommand('approve', undefined, store, io)).toBe(2)
    expect(errores.join('')).toContain('falta el identificador')
  })

  it('un identificador que no existe da error de ejecución', () => {
    const store = new ApprovalStore({ dir })
    expect(runApprovalCommand('approve', 'no-existe', store, io)).toBe(1)
    expect(errores.join('')).toContain('desconocida')
  })

  it('rechaza un comando que no conoce', () => {
    const store = new ApprovalStore({ dir })
    expect(runApprovalCommand('destruir-todo', undefined, store, io)).toBe(2)
    expect(errores.join('')).toContain('comando desconocido')
  })

  it('si el almacén no sirve, no intenta aprobar nada', () => {
    const asFile = join(dir, 'soy-un-fichero')
    writeFileSync(asFile, 'x')
    const store = new ApprovalStore({ dir: asFile })
    expect(runApprovalCommand('approve', 'x', store, io)).toBe(1)
    expect(errores.join('')).toContain('almacén')
  })
})

describe('ramas defensivas', () => {
  it('una solicitud ilegible se salta sin romper el listado', () => {
    const { store, id } = conSolicitud()
    // Fichero con JSON inválido en el directorio de pendientes.
    writeFileSync(join(dir, 'pending', 'rota.json'), 'no-es-json')

    expect(runApprovalCommand('pending', undefined, store, io)).toBe(0)
    expect(texto()).toContain(id)
    // La rota no revienta la salida ni aparece con datos inventados.
    expect(texto()).not.toContain('rota')
  })

  it('buscar un permiso en un almacén inservible no lanza', () => {
    const asFile = join(dir, 'fichero')
    writeFileSync(asFile, 'x')
    const store = new ApprovalStore({ dir: asFile })
    expect(store.findClaimable('lo-que-sea', 'alex', 's1')).toBeNull()
    expect(store.pendingIds()).toEqual([])
  })
})
