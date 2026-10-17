/**
 * Tests unitarios para agent/executor.ts (30.66% cobertura).
 *
 * Estrategia: mockeamos loadConfig, createLogger, AlertSystem, runSetup,
 * buildOrganizationPlan y las importaciones dinámicas (pass, drive, discovery)
 * para que runAgent ejecute cada goal en un entorno controlado sin I/O real.
 *
 * Cubrimos los 14 goals + paths de error (producto deshabilitado, setup
 * fallido, check-imap fallido, fallos de operaciones Drive).
 *
 * IMPORTANTE: vi.mock() es hoisteado al tope del módulo, ANTES de cualquier
 * declaración const/let. Por eso los objetos compartidos se inicializan con
 * vi.hoisted(), que se ejecuta ANTES que los factories de vi.mock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runAgent } from '../src/agent/executor.js'
import { buildOrganizationPlan, applyOrganizationPlan } from '../src/agent/organizer.js'
import { runSetup, runImapCheck } from '../src/agent/setup.js'
import { loadConfig, type Config } from '../src/config.js'

// ---------------------------------------------------------------------------
// Objetos compartidos — inicializados con vi.hoisted() para que estén
// disponibles cuando los factories de vi.mock se ejecuten.
// ---------------------------------------------------------------------------
const { defaultConfig, mockLogFns, mockAlertFns, setupReportMock, failReportMock, planMock } = vi.hoisted(() => {
  const defaultConfig: Config = {
    products: {
      mail: {
        enabled: true,
        bridge: {
          user: 'test@proton.me', pass: 'x', host: '127.0.0.1',
          imapPort: 1143, smtpPort: 1025, from: 'test@proton.me',
          tlsInsecure: true, smtpSecurity: 'starttls',
        },
      },
      pass: { enabled: false, storeDir: '~/.password-store' },
      calendar: { enabled: false },
      drive: { enabled: false, cliBin: 'proton-drive', stagingDir: '/tmp/staging', obsoleteExtensions: ['.doc'] },
    },
    transport: { kind: 'stdio', httpHost: '127.0.0.1', httpPort: 8787, allowedOrigins: [] },
    alerts: { enabled: true, minSeverity: 'warning', logDir: 'logs' },
    agent: { dryRun: true, maxInspectEmails: 1000, minConfidence: 0.5 },
    // Politica declarada a proposito: estas pruebas comprueban el comportamiento
    // de los objetivos del agente, NO la autorizacion. El control del CLI se
    // prueba en tests/agent/cli-authz.test.ts.
    authz: {
      mode: 'enforce',
      actor: 'test',
      approvalDir: '/tmp/test-executor-authz',
      journalFile: '/tmp/test-executor-authz.jsonl',
      allow: ['read', 'write', 'destructive', 'admin'],
      requireApproval: [],
    },
    logLevel: 'info',
  }
  return {
    defaultConfig,
    mockLogFns: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    mockAlertFns: {
      init: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(), info: vi.fn(), warning: vi.fn(),
      alert: vi.fn(), critical: vi.fn(), audit: vi.fn(),
    },
    setupReportMock: {
      bridgeReachable: true, imapOk: true, smtpOk: true, authOk: true,
      folders: ['INBOX', 'Trash', 'Folders/Pagos'],
      recommendations: [],
    },
    failReportMock: {
      bridgeReachable: false, imapOk: false, smtpOk: false, authOk: false,
      folders: [],
      recommendations: ['Bridge no est\u00e1 escuchando IMAP'],
    },
    planMock: {
      newFolders: ['Folders/Admin'],
      folderProposals: [{ path: 'Folders/Admin', reason: 'Admin emails', emails: [42], suggestedLabels: [] }],
      labelProposals: [{ name: 'Labels/Por resolver', reason: 'Action needed', emails: [42] }],
      alerts: [],
    },
  }
})

const { mockPassClientFns, mockDriveClientFns, mockDriveAuditorFns, mockApplyOrganizePlan, mockBinaries } = vi.hoisted(() => ({
  mockApplyOrganizePlan: vi.fn().mockReturnValue({
    moved: 0,
    skipped: 0,
    failed: 0,
    results: [],
  }),
  mockPassClientFns: {
    audit: vi.fn().mockResolvedValue({
      storeOk: true, totalEntries: 5,
      weakPasswords: ['servicios/old'], duplicates: [], staleEntries: [],
      rotationPlan: [{ path: 'servicios/old', reason: 'weak', action: 'regenerate' }],
      recommendations: ['Regenerar contrase\u00f1as d\u00e9biles'],
    }),
    generate: vi.fn().mockResolvedValue({ path: 'servicios/old', length: 24 }),
    getBackendBinary: vi.fn().mockReturnValue('pass'),
  },
  mockDriveClientFns: {
    stagingDir: '/tmp/staging',
    listFiles: vi.fn().mockResolvedValue({ ok: true, files: [{ name: 'doc.md' }] }),
    download: vi.fn().mockResolvedValue({ ok: true, localPath: '/tmp/staging/download' }),
    upload: vi.fn().mockResolvedValue({ ok: true, remotePath: '/my-files/upload' }),
  },
  mockDriveAuditorFns: {
    scanInventory: vi.fn().mockReturnValue({ totalFiles: 10, totalBytes: 1024, byExt: {}, byDir: {}, files: [] }),
    findDuplicates: vi.fn().mockReturnValue([]),
    formatReport: vi.fn().mockReturnValue({ totalExtensions: 3, extensions: ['.md', '.txt', '.jpg'], obsoleteExtensions: [], obsoleteFiles: [], noExtension: 0 }),
    buildOrganizePlan: vi.fn().mockReturnValue({
      strategy: 'reject',
      suggestions: [],
      movable: 0,
      blocked: 0,
    }),
  },
  mockBinaries: [
    { name: 'protonmail-bridge-core', installed: true, version: '3.24.0', authenticated: true },
    { name: 'pass', installed: true, version: '1.7.4', authenticated: undefined },
    { name: 'proton-drive', installed: false, authenticated: undefined },
  ],
}))

// ---------------------------------------------------------------------------
// Mocks — los factories referencian objetos de vi.hoisted() que ya existen
// ---------------------------------------------------------------------------
vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(defaultConfig),
  createLogger: vi.fn().mockReturnValue(mockLogFns),
  resolveBridgeConfig: vi.fn().mockResolvedValue({
    user: 'test@proton.me', pass: 'x', passwordResolver: () => Promise.resolve('x'),
    host: '127.0.0.1', imapPort: 1143, smtpPort: 1025, from: 'test@proton.me',
    tlsInsecure: true, smtpSecurity: 'starttls',
  }),
}))

vi.mock('../src/alerts/index.js', () => ({
  AlertSystem: vi.fn().mockImplementation(() => mockAlertFns),
}))

vi.mock('../src/agent/setup.js', () => ({
  runSetup: vi.fn().mockResolvedValue(setupReportMock),
  runImapCheck: vi.fn().mockResolvedValue(setupReportMock),
}))

vi.mock('../src/agent/organizer.js', () => ({
  buildOrganizationPlan: vi.fn().mockResolvedValue(planMock),
  applyOrganizationPlan: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/pass.js', () => ({
  PassClient: vi.fn().mockImplementation(() => mockPassClientFns),
}))

vi.mock('../src/drive.js', () => ({
  DriveClient: vi.fn().mockImplementation(() => mockDriveClientFns),
}))

vi.mock('../src/drive-audit.js', () => ({
  DriveAuditor: vi.fn().mockImplementation(() => mockDriveAuditorFns),
  applyOrganizePlan: (...args: unknown[]) => mockApplyOrganizePlan(...args),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    // Se espía pero se deja pasar a la implementación real: el almacén de
    // aprobaciones necesita crear directorios de verdad.
    mkdirSync: vi.fn(actual.mkdirSync),
    renameSync: vi.fn(),
  }
})

vi.mock('../src/ecosystem/discovery.js', () => ({
  checkAllBinaries: vi.fn().mockReturnValue(mockBinaries),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withPassEnabled(): Config {
  return { ...defaultConfig, products: { ...defaultConfig.products, pass: { enabled: true, storeDir: '~/.password-store' } } }
}

function withDriveEnabled(): Config {
  return {
    ...defaultConfig,
    products: { ...defaultConfig.products, drive: { enabled: true, cliBin: 'proton-drive', stagingDir: '/tmp/staging', obsoleteExtensions: ['.doc'] } },
  }
}

function withDryRun(dryRun: boolean): Config {
  return { ...defaultConfig, agent: { ...defaultConfig.agent, dryRun } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfig).mockReturnValue(defaultConfig)
  vi.mocked(runSetup).mockResolvedValue(setupReportMock)
  vi.mocked(runImapCheck).mockResolvedValue(setupReportMock)
  vi.mocked(buildOrganizationPlan).mockResolvedValue(planMock)
  vi.mocked(applyOrganizationPlan).mockResolvedValue(undefined)
  mockDriveClientFns.listFiles.mockResolvedValue({ ok: true, files: [{ name: 'doc.md' }] })
  mockDriveClientFns.download.mockResolvedValue({ ok: true, localPath: '/tmp/staging/download' })
  mockDriveClientFns.upload.mockResolvedValue({ ok: true, remotePath: '/my-files/upload' })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgent · discover', () => {
  it('llama a runSetup y loguea el reporte', async () => {
    await runAgent('discover')
    expect(runSetup).toHaveBeenCalledTimes(1)
    expect(mockLogFns.info).toHaveBeenCalledWith('discover report', { report: setupReportMock })
  })
})

describe('runAgent · setup', () => {
  it('loguea éxito cuando IMAP y SMTP funcionan', async () => {
    await runAgent('setup')
    expect(runSetup).toHaveBeenCalledTimes(1)
    expect(mockLogFns.info).toHaveBeenCalledWith('setup complete', { folders: 3 })
  })

  it('exit(2) cuando IMAP o SMTP fallan', async () => {
    vi.mocked(runSetup).mockResolvedValue(failReportMock)
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runAgent('setup')
    expect(spy).toHaveBeenCalledWith(2)
    expect(mockLogFns.error).toHaveBeenCalledWith('setup incomplete', expect.any(Object))
    spy.mockRestore()
  })
})

describe('runAgent · check-imap', () => {
  it('llama a runImapCheck y loguea resultado', async () => {
    await runAgent('check-imap')
    expect(runImapCheck).toHaveBeenCalledTimes(1)
    expect(mockLogFns.info).toHaveBeenCalledWith('check-imap report', expect.objectContaining({ imapOk: true }))
  })

  it('exit(2) si IMAP no disponible', async () => {
    vi.mocked(runImapCheck).mockResolvedValue({ ...failReportMock, imapOk: false })
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runAgent('check-imap')
    expect(spy).toHaveBeenCalledWith(2)
    spy.mockRestore()
  })
})

describe('runAgent · organize', () => {
  it('dry-run: buildOrganizationPlan sin aplicar', async () => {
    await runAgent('organize')
    expect(buildOrganizationPlan).toHaveBeenCalledTimes(1)
    expect(applyOrganizationPlan).not.toHaveBeenCalled()
    expect(mockAlertFns.info).toHaveBeenCalledWith('organize', expect.stringContaining('dry-run'), 'agent/executor', expect.any(Object))
  })

  it('no dry-run: aplica plan y audita', async () => {
    vi.mocked(loadConfig).mockReturnValue(withDryRun(false))
    await runAgent('organize')
    expect(applyOrganizationPlan).toHaveBeenCalledTimes(1)
    expect(mockAlertFns.audit).toHaveBeenCalledWith('organize-applied', 'agent/executor', expect.any(Object))
  })
})

describe('runAgent · monitor', () => {
  it('buildOrganizationPlan + resumen sin aplicar', async () => {
    await runAgent('monitor')
    expect(buildOrganizationPlan).toHaveBeenCalledTimes(1)
    expect(applyOrganizationPlan).not.toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest Matcher<any> in objectContaining slot
    expect(mockLogFns.info).toHaveBeenCalledWith('monitor/alert plan', expect.objectContaining({ newFolders: expect.any(Array) }))
  })
})

describe('runAgent · alert', () => {
  it('buildOrganizationPlan sin aplicar', async () => {
    await runAgent('alert')
    expect(buildOrganizationPlan).toHaveBeenCalledTimes(1)
    expect(applyOrganizationPlan).not.toHaveBeenCalled()
  })
})

describe('runAgent · pass-audit', () => {
  it('audita vault cuando Pass habilitado', async () => {
    vi.mocked(loadConfig).mockReturnValue(withPassEnabled())
    await runAgent('pass-audit')
    expect(mockPassClientFns.audit).toHaveBeenCalled()
    expect(mockLogFns.info).toHaveBeenCalledWith('pass-audit report', expect.objectContaining({ totalEntries: 5 }))
  })

  it('en dry-run registra rotation plan sin regenerar', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...withPassEnabled(),
      agent: { ...defaultConfig.agent, dryRun: true },
    })
    await runAgent('pass-audit')
    expect(mockLogFns.info).toHaveBeenCalledWith(
      'pass-audit rotation plan (dry-run)',
      expect.objectContaining({ items: expect.any(Array) }),
    )
    expect(mockPassClientFns.generate).not.toHaveBeenCalled()
  })

  it('sin dry-run la auditoría sigue siendo de solo lectura (F01)', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...withPassEnabled(),
      agent: { ...defaultConfig.agent, dryRun: false },
    })
    await runAgent('pass-audit')
    expect(mockPassClientFns.generate).not.toHaveBeenCalled()
    expect(mockLogFns.warn).toHaveBeenCalledWith(
      'pass-audit is read-only; rotationPlan NOT applied',
      expect.objectContaining({ items: 1 }),
    )
    expect(mockAlertFns.audit).toHaveBeenCalledWith(
      'pass-audit',
      'agent/executor',
      expect.objectContaining({ applied: 0, dryRun: false }),
    )
  })

  it('exit(2) cuando Pass no habilitado', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runAgent('pass-audit')
    expect(spy).toHaveBeenCalledWith(2)
    expect(mockLogFns.error).toHaveBeenCalledWith('Proton Pass is not enabled. Set PROTON_PASS_ENABLED=true.')
    spy.mockRestore()
  })
})

describe('runAgent · drive goals', () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue(withDriveEnabled())
  })

  it('drive-audit escanea inventario, duplicados y formatos', async () => {
    await runAgent('drive-audit')
    expect(mockDriveAuditorFns.scanInventory).toHaveBeenCalled()
    expect(mockDriveAuditorFns.findDuplicates).toHaveBeenCalled()
    expect(mockDriveAuditorFns.formatReport).toHaveBeenCalled()
  })

  it('drive-organize en dry-run loguea plan', async () => {
    await runAgent('drive-organize')
    expect(mockDriveAuditorFns.buildOrganizePlan).toHaveBeenCalled()
    expect(mockLogFns.info).toHaveBeenCalledWith('drive-organize plan (dry-run)', expect.objectContaining({ suggestions: 0 }))
  })

  it('drive-organize sin dry-run aplica con el motor compartido (F02)', async () => {
    mockDriveAuditorFns.buildOrganizePlan.mockReturnValue({
      strategy: 'reject',
      suggestions: [{ action: 'move', from: 'a.doc', to: 'docs/a.doc', reason: 'r' }],
      movable: 1,
      blocked: 0,
    })
    mockApplyOrganizePlan.mockReturnValue({
      moved: 1,
      skipped: 0,
      failed: 0,
      results: [{ from: 'a.doc', to: 'docs/a.doc', status: 'moved' }],
    })
    vi.mocked(loadConfig).mockReturnValue({
      ...withDriveEnabled(),
      agent: { ...defaultConfig.agent, dryRun: false },
    })
    await runAgent('drive-organize')
    expect(mockApplyOrganizePlan).toHaveBeenCalledWith(
      '/tmp/staging',
      expect.objectContaining({ movable: 1 }),
      expect.anything(),
    )
    expect(mockLogFns.info).toHaveBeenCalledWith('drive-organize applied', {
      moved: 1,
      skipped: 0,
      failed: 0,
    })
  })

  it('drive-organize informa de fallos parciales sin inventar éxito (F02)', async () => {
    mockApplyOrganizePlan.mockReturnValue({
      moved: 1,
      skipped: 0,
      failed: 2,
      results: [],
    })
    vi.mocked(loadConfig).mockReturnValue({
      ...withDriveEnabled(),
      agent: { ...defaultConfig.agent, dryRun: false },
    })
    await runAgent('drive-organize')
    expect(mockLogFns.info).toHaveBeenCalledWith('drive-organize applied', {
      moved: 1,
      skipped: 0,
      failed: 2,
    })
    expect(mockAlertFns.audit).toHaveBeenCalledWith(
      'drive-organize-applied',
      'agent/executor',
      { moved: 1, skipped: 0, failed: 2 },
    )
  })

  it('drive-list lista archivos remotos', async () => {
    await runAgent('drive-list')
    expect(mockDriveClientFns.listFiles).toHaveBeenCalled()
    expect(mockLogFns.info).toHaveBeenCalledWith('drive-list ok', expect.objectContaining({ entries: 1 }))
  })

  it('drive-list exit(2) cuando falla', async () => {
    mockDriveClientFns.listFiles.mockResolvedValue({ ok: false, error: 'not logged in', files: [] })
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runAgent('drive-list')
    expect(spy).toHaveBeenCalledWith(2)
    spy.mockRestore()
  })

  it('drive-download descarga archivos', async () => {
    await runAgent('drive-download')
    expect(mockDriveClientFns.download).toHaveBeenCalled()
    expect(mockLogFns.info).toHaveBeenCalledWith('drive-download ok', expect.any(Object))
  })

  it('drive-download exit(2) cuando falla', async () => {
    mockDriveClientFns.download.mockResolvedValue({ ok: false, error: 'timeout', localPath: '' })
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runAgent('drive-download')
    expect(spy).toHaveBeenCalledWith(2)
    spy.mockRestore()
  })

  it('drive-upload sube archivos', async () => {
    await runAgent('drive-upload')
    expect(mockDriveClientFns.upload).toHaveBeenCalled()
    expect(mockLogFns.info).toHaveBeenCalledWith('drive-upload ok', expect.any(Object))
  })

  it('drive-upload exit(2) cuando falla', async () => {
    mockDriveClientFns.upload.mockResolvedValue({ ok: false, error: 'auth expired', remotePath: '' })
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runAgent('drive-upload')
    expect(spy).toHaveBeenCalledWith(2)
    spy.mockRestore()
  })

  it('exit(2) cuando Drive no está habilitado', async () => {
    vi.mocked(loadConfig).mockReturnValue(defaultConfig)
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runAgent('drive-audit')
    expect(spy).toHaveBeenCalledWith(2)
    expect(mockLogFns.error).toHaveBeenCalledWith('Drive is not configured. Set DRIVE_ENABLED=true.')
    spy.mockRestore()
  })
})

describe('runAgent · suite-status', () => {
  it('loguea estado de todos los productos', async () => {
    await runAgent('suite-status')
    /* eslint-disable @typescript-eslint/no-unsafe-assignment -- vitest Matcher<any> in objectContaining slot */
    expect(mockLogFns.info).toHaveBeenCalledWith('suite status', expect.objectContaining({
      mail: expect.any(String), pass: expect.any(String),
      calendar: expect.any(String), drive: expect.any(String),
    }))
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  })
})

describe('runAgent · suite-manage', () => {
  it('descubre binarios y loguea estado', async () => {
    await runAgent('suite-manage')
    expect(mockLogFns.info).toHaveBeenCalledWith('suite-manage: discovering Proton ecosystem binaries')
    expect(mockLogFns.info).toHaveBeenCalledWith('  protonmail-bridge-core: installed (3.24.0), auth: true')
    expect(mockLogFns.info).toHaveBeenCalledWith('  pass: installed (1.7.4)')
    expect(mockLogFns.info).toHaveBeenCalledWith('  proton-drive: not installed')
    expect(mockAlertFns.audit).toHaveBeenCalledWith('suite-manage', 'agent/executor', expect.objectContaining({
      totalBinaries: 3, installed: 2,
    }))
  })
})

// ===========================================================================
// El CLI del agente pasa por el MISMO control que las herramientas MCP.
// Si no pasara, sería una vía para mutar sin autorización (hallazgo F03).
// ===========================================================================

describe('runAgent · control de autorización en el CLI', () => {
  const DIR = '/tmp/test-executor-cli-authz'

  function conPolitica(requireApproval: boolean): Config {
    return {
      ...withDriveEnabled(),
      agent: { ...defaultConfig.agent, dryRun: false },
      authz: {
        mode: 'enforce',
        actor: 'test',
        approvalDir: DIR,
        journalFile: null,
        allow: requireApproval ? ['read'] : ['read', 'write', 'destructive', 'admin'],
        requireApproval: requireApproval
          ? ['write', 'destructive', 'admin']
          : [],
      },
    }
  }

  it('sin aprobación, un objetivo que escribe NO se ejecuta y sale con 3', async () => {
    vi.mocked(loadConfig).mockReturnValue(conPolitica(true))
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)

    await runAgent('drive-organize')

    expect(mockApplyOrganizePlan).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(3)
    expect(mockLogFns.error).toHaveBeenCalledWith(
      expect.stringContaining('Sin ejecutar'),
    )
    exitSpy.mockRestore()
  })

  it('con la clase autorizada, el objetivo sí se ejecuta', async () => {
    vi.mocked(loadConfig).mockReturnValue(conPolitica(false))
    mockApplyOrganizePlan.mockReturnValue({ moved: 0, skipped: 0, failed: 0, results: [] })

    await runAgent('drive-organize')

    expect(mockApplyOrganizePlan).toHaveBeenCalled()
  })

  it('en modo seco no pide aprobación: no toca nada', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...conPolitica(true),
      agent: { ...defaultConfig.agent, dryRun: true },
    })

    await runAgent('drive-organize')

    expect(mockApplyOrganizePlan).not.toHaveBeenCalled()
    expect(mockLogFns.info).toHaveBeenCalledWith(
      'drive-organize plan (dry-run)',
      expect.anything(),
    )
  })

  it('un objetivo de solo lectura no pide aprobación', async () => {
    vi.mocked(loadConfig).mockReturnValue(conPolitica(true))

    await runAgent('suite-status')

    expect(mockLogFns.info).toHaveBeenCalledWith('suite status', expect.anything())
  })
})
