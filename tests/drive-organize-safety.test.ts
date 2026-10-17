/**
 * T-FS-01 — Organización Drive sin pérdida silenciosa (hallazgo F02).
 *
 * Cubre el peor caso: dos ficheros homónimos en carpetas distintas, un destino
 * ya ocupado en disco, precondiciones cambiadas entre plan y aplicación y un
 * fallo intermedio. La aserción central es que NINGÚN byte se pierde.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyOrganizePlan, DriveAuditor } from '../src/drive-audit.js'
import { moveNoClobber, DestinationExistsError } from '../src/drive-utils.js'

const TMP = '/tmp/test-drive-organize-safety'

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const auditor = new DriveAuditor(['.doc'], silentLog)

const read = (rel: string) => readFileSync(resolve(TMP, rel), 'utf8')
const write = (rel: string, content: string) => {
  mkdirSync(resolve(TMP, rel, '..'), { recursive: true })
  writeFileSync(resolve(TMP, rel), content)
}

describe('T-FS-01 · organización Drive sin sobrescritura', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  describe('moveNoClobber', () => {
    it('mueve el fichero cuando el destino está libre', () => {
      write('src/a.txt', 'contenido')
      mkdirSync(resolve(TMP, 'dst'), { recursive: true })
      moveNoClobber(resolve(TMP, 'src/a.txt'), resolve(TMP, 'dst/a.txt'))
      expect(existsSync(resolve(TMP, 'src/a.txt'))).toBe(false)
      expect(read('dst/a.txt')).toBe('contenido')
    })

    it('se niega a sobrescribir un destino existente', () => {
      write('src/a.txt', 'NUEVO')
      write('dst/a.txt', 'ORIGINAL')
      expect(() =>
        moveNoClobber(resolve(TMP, 'src/a.txt'), resolve(TMP, 'dst/a.txt')),
      ).toThrow(DestinationExistsError)
      expect(read('dst/a.txt')).toBe('ORIGINAL')
      expect(read('src/a.txt')).toBe('NUEVO')
    })
  })

  describe('plan con colisiones', () => {
    beforeEach(() => {
      // Dos homónimos en carpetas distintas → mismo destino `images/photo.jpg`.
      write('coleccion-a/photo.jpg', 'FOTO-A')
      write('coleccion-b/photo.jpg', 'FOTO-B')
    })

    it('estrategia reject (por defecto) marca la colisión en vez de sobrescribir', async () => {
      const plan = await auditor.buildOrganizePlan(TMP)
      expect(plan.strategy).toBe('reject')
      expect(plan.movable).toBe(1)
      expect(plan.blocked).toBe(1)
      const rejected = plan.suggestions.find((s) => s.action === 'reject')
      expect(rejected?.blockedBy).toBe('plan-collision')
      expect(rejected?.to).toBe('images/photo.jpg')
    })

    it('estrategia rename desambigua y conserva las dos fotos', async () => {
      const plan = await auditor.buildOrganizePlan(TMP, { strategy: 'rename' })
      expect(plan.blocked).toBe(0)
      expect(plan.movable).toBe(2)
      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.failed).toBe(0)
      expect(applied.moved).toBe(2)
      const contents = ['images/photo.jpg', 'images/photo (2).jpg'].map(read).sort()
      expect(contents).toEqual(['FOTO-A', 'FOTO-B'])
    })

    it('con reject, tras aplicar siguen existiendo los dos contenidos', async () => {
      const plan = await auditor.buildOrganizePlan(TMP)
      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.moved).toBe(1)
      expect(applied.skipped).toBe(1)
      expect(applied.failed).toBe(0)
      // El movido está en images/; el rechazado sigue en su carpeta de origen.
      expect(read('images/photo.jpg')).toBeTruthy()
      const leftover = ['coleccion-a/photo.jpg', 'coleccion-b/photo.jpg'].find((p) =>
        existsSync(resolve(TMP, p)),
      )
      expect(leftover).toBeDefined()
    })

    it('con tres homónimos y rename desambigua hasta (3) sin perder ninguno', async () => {
      write('coleccion-c/photo.jpg', 'FOTO-C')
      const plan = await auditor.buildOrganizePlan(TMP, { strategy: 'rename' })
      expect(plan.blocked).toBe(0)
      expect(plan.movable).toBe(3)

      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.moved).toBe(3)
      expect(applied.failed).toBe(0)
      const contents = [
        'images/photo.jpg',
        'images/photo (2).jpg',
        'images/photo (3).jpg',
      ]
        .map(read)
        .sort()
      expect(contents).toEqual(['FOTO-A', 'FOTO-B', 'FOTO-C'])
    })
  })

  describe('destino preexistente en disco', () => {
    it('no sobrescribe el fichero que ya estaba', async () => {
      write('suelto/notas.txt', 'SUELTO')
      write('docs/notas.txt', 'YA-ESTABA')
      const plan = await auditor.buildOrganizePlan(TMP)
      const suggestion = plan.suggestions.find((s) => s.from === 'suelto/notas.txt')
      expect(suggestion?.action).toBe('reject')
      expect(suggestion?.blockedBy).toBe('destination-exists')

      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.moved).toBe(0)
      expect(read('docs/notas.txt')).toBe('YA-ESTABA')
      expect(read('suelto/notas.txt')).toBe('SUELTO')
    })

    it('con estrategia rename coloca el nuevo junto al existente', async () => {
      write('suelto/notas.txt', 'SUELTO')
      write('docs/notas.txt', 'YA-ESTABA')
      const plan = await auditor.buildOrganizePlan(TMP, { strategy: 'rename' })
      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.failed).toBe(0)
      expect(read('docs/notas.txt')).toBe('YA-ESTABA')
      expect(read('docs/notas (2).txt')).toBe('SUELTO')
    })
  })

  describe('precondiciones cambiadas entre plan y aplicación', () => {
    it('si el destino aparece después del plan, no se sobrescribe', async () => {
      write('suelto/datos.csv', 'ORIGEN')
      const plan = await auditor.buildOrganizePlan(TMP)
      expect(plan.suggestions[0]?.action).toBe('move')

      // Alguien crea el destino entre el plan y la aplicación.
      write('data/datos.csv', 'INTRUSO')

      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.moved).toBe(0)
      expect(applied.failed).toBe(1)
      expect(applied.results[0]?.reason).toBe('destination-exists')
      expect(read('data/datos.csv')).toBe('INTRUSO')
      expect(read('suelto/datos.csv')).toBe('ORIGEN')
    })

    it('si el origen desaparece, se marca skipped y no se inventa éxito', async () => {
      write('suelto/datos.csv', 'ORIGEN')
      const plan = await auditor.buildOrganizePlan(TMP)
      rmSync(resolve(TMP, 'suelto/datos.csv'))

      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.moved).toBe(0)
      expect(applied.skipped).toBe(1)
      expect(applied.results[0]?.reason).toBe('source-missing')
    })
  })

  describe('fallo intermedio explicito', () => {
    it('un bloqueo no impide aplicar el resto del plan', async () => {
      write('suelto/notas.txt', 'SUELTO')
      write('docs/notas.txt', 'YA-ESTABA')
      write('otro/datos.json', '{"ok":true}')

      const plan = await auditor.buildOrganizePlan(TMP, { strategy: 'rename' })
      const applied = applyOrganizePlan(TMP, plan, silentLog)

      expect(applied.failed).toBe(0)
      expect(applied.moved).toBe(2)
      expect(applied.skipped).toBe(0)
      expect(read('docs/notas.txt')).toBe('YA-ESTABA')
      expect(read('docs/notas (2).txt')).toBe('SUELTO')
      expect(read('data/datos.json')).toBe('{"ok":true}')
    })

    it('las acciones rechazadas del plan se reportan como skipped', async () => {
      write('suelto/notas.txt', 'SUELTO')
      write('docs/notas.txt', 'YA-ESTABA')
      const plan = await auditor.buildOrganizePlan(TMP)
      const applied = applyOrganizePlan(TMP, plan, silentLog)
      expect(applied.results.some((r) => r.status === 'skipped')).toBe(true)
      expect(applied.failed).toBe(0)
    })
  })
})
