/**
 * T-AUDIT-01 — La auditoría no puede mentir ni desaparecer en silencio.
 *
 * Antes, `audit()` era «best effort»: se lanzaba sin esperar y se tragaba el
 * error. Si el disco estaba lleno o el directorio no existía, la operación se
 * ejecutaba y **no quedaba rastro**, sin que nadie se enterara (hallazgo F42).
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertSystem } from '../../src/alerts/index.js'
import { Journal, JOURNAL_SCHEMA_VERSION } from '../../src/authz/index.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audit-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

const alertsCfg = (logDir: string) =>
  ({ enabled: true, logDir, minSeverity: 'warning' }) as never

describe('auditoría de alertas · escritura con acuse', () => {
  it('dice que sí cuando la entrada quedó escrita', async () => {
    const alerts = new AlertSystem(alertsCfg(join(dir, 'logs')), log)

    await expect(alerts.audit('organize', 'agent/executor', { movidos: 3 })).resolves.toBe(true)
  })

  it('dice que no cuando el sumidero falla, y lo deja visible', async () => {
    // Un fichero donde debería haber un directorio: la escritura falla.
    const roto = join(dir, 'soy-un-fichero')
    writeFileSync(roto, 'x')
    const alerts = new AlertSystem(alertsCfg(roto), log)

    await expect(alerts.audit('organize', 'agent/executor', {})).resolves.toBe(false)
    expect(log.error).toHaveBeenCalledWith(
      'audit sink failed',
      expect.objectContaining({ action: 'organize' }),
    )
  })

  it('flush espera a que terminen las escrituras en curso', async () => {
    const logDir = join(dir, 'logs')
    const alerts = new AlertSystem(alertsCfg(logDir), log)

    // Sin esperar: se piden varias y se drena al final.
    void alerts.audit('uno', 'origen')
    void alerts.audit('dos', 'origen')
    void alerts.audit('tres', 'origen')
    await alerts.flush()

    const ficheros = readdirSync(logDir)
    expect(ficheros).toHaveLength(1)
    const contenido = readFileSync(join(logDir, ficheros[0]!), 'utf8')
    for (const accion of ['uno', 'dos', 'tres']) {
      expect(contenido).toContain(accion)
    }
  })
})

describe('diario de autorización · versión y rotación', () => {
  const entrada = {
    correlationId: 'c-1',
    toolId: 'proton_send_email',
    effectClass: 'write' as const,
    decision: 'require_approval' as const,
    outcome: 'pending-approval' as const,
    actor: 'alex',
    sessionId: 's1',
    reason: 'exige aprobación',
  }

  it('cada línea lleva la versión del esquema', () => {
    const file = join(dir, 'authz.jsonl')
    new Journal({ file }).write(entrada)

    const primera = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!) as Record<string, unknown>
    expect(primera['schemaVersion']).toBe(JOURNAL_SCHEMA_VERSION)
  })

  it('rota al pasar del tamaño máximo y conserva las copias pedidas', () => {
    const file = join(dir, 'authz.jsonl')
    const journal = new Journal({ file, maxBytes: 300, keep: 2 })

    for (let i = 0; i < 40; i++) {
      journal.write({ ...entrada, correlationId: `c-${i}` })
    }

    expect(existsSync(file)).toBe(true)
    expect(existsSync(`${file}.1`)).toBe(true)
    // `keep: 2` significa como mucho dos copias: la tercera se descarta.
    expect(existsSync(`${file}.3`)).toBe(false)
  })

  it('lo último escrito sigue estando tras rotar', () => {
    const file = join(dir, 'authz.jsonl')
    const journal = new Journal({ file, maxBytes: 300, keep: 2 })

    for (let i = 0; i < 40; i++) {
      journal.write({ ...entrada, correlationId: `c-${i}` })
    }

    expect(readFileSync(file, 'utf8')).toContain('c-39')
  })

  it('si no puede escribir, lo dice', () => {
    const roto = join(dir, 'fichero')
    writeFileSync(roto, 'x')
    const journal = new Journal({ file: join(roto, 'sub', 'authz.jsonl') })

    expect(journal.write(entrada)).toBe(false)
  })

  it('sin fichero configurado es un no-op y no falla', () => {
    expect(new Journal({ file: null }).write(entrada)).toBe(true)
  })
})
