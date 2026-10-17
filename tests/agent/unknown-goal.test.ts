/**
 * Rama defensiva: un objetivo del CLI que no tiene manejador.
 *
 * Es inalcanzable por el camino normal —`parseGoal` valida contra la lista y
 * todos tienen manejador—, pero existe para que un descuido futuro falle con un
 * código claro en vez de seguir como si nada. Se prueba forzando el caso.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/agent/goals.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agent/goals.js')>()
  return {
    ...actual,
    // Solo se fuerza `parseGoal`; el resto del módulo queda real.
    parseGoal: () => 'objetivo-sin-manejador',
  }
})

vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.js')>()
  return {
    ...actual,
    loadConfig: () => ({
      products: {
        mail: {
          enabled: false,
          bridge: { user: 'x@y.z', pass: 'p', from: 'x@y.z', host: '127.0.0.1', imapPort: 1143, smtpPort: 1025 },
        },
        pass: { enabled: false, storeDir: '/tmp' },
        calendar: { enabled: false, experimental: false },
        drive: { enabled: false, cliBin: 'proton-drive', stagingDir: '/tmp', obsoleteExtensions: [] },
      },
      transport: { kind: 'stdio', httpHost: '127.0.0.1', httpPort: 8787, allowedOrigins: [] },
      alerts: { enabled: false, logDir: '/tmp', minSeverity: 'warning' },
      agent: { dryRun: true, maxInspectEmails: 10, minConfidence: 0.6 },
      logLevel: 'error',
    }),
  }
})

vi.mock('../../src/alerts/index.js', () => ({
  AlertSystem: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    audit: vi.fn().mockResolvedValue(true),
    info: vi.fn(),
    warning: vi.fn(),
    alert: vi.fn(),
    critical: vi.fn(),
    emit: vi.fn(),
  })),
}))

const { runAgent } = await import('../../src/agent/executor.js')

describe('objetivo sin manejador', () => {
  it('sale con código 2 y lo dice, en vez de seguir como si nada', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)

    await runAgent('objetivo-sin-manejador')

    expect(exitSpy).toHaveBeenCalledWith(2)

    exitSpy.mockRestore()
    errSpy.mockRestore()
  })
})
