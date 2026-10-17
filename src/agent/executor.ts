import { AlertSystem } from '../alerts/index.js'
import { loadConfig, type Config } from '../config.js'
import { createLogger } from '../config.js'
import type { OrganizeApplyResult, OrganizePlan } from '../drive-audit.js'
import type { AgentGoal } from './goals.js'
import { parseGoal, buildGoalContext, describeGoal } from './goals.js'
import { buildOrganizationPlan, applyOrganizationPlan } from './organizer.js'
import { runSetup, runImapCheck } from './setup.js'

export async function runAgent(
  goalName: string,
  _env?: NodeJS.ProcessEnv,
): Promise<void> {
  const goal = parseGoal(goalName)
  const cfg = loadConfig()
  const log = createLogger(cfg.logLevel)
  const alerts = new AlertSystem(cfg.alerts, log)
  await alerts.init()

  const ctx = buildGoalContext(goal, cfg.agent)
  log.info('agent goal', {
    goal,
    dryRun: ctx.dryRun,
    description: describeGoal(goal),
  })
  alerts.audit('agent-start', 'agent/executor', { goal, dryRun: ctx.dryRun })

  const handler = goalHandlers[goal]
  if (handler) {
    const result = handler({ cfg, ctx, log, alerts })
    if (result instanceof Promise) await result
  } else {
    log.error(`Unknown agent goal: ${goal}`)
    process.exit(2)
  }

  alerts.audit('agent-end', 'agent/executor', { goal })
}
// ---------------------------------------------------------------------------

interface GoalHandlerArgs {
  cfg: Config
  ctx: { goal: AgentGoal; dryRun: boolean; maxInspectEmails: number; minConfidence: number }
  log: ReturnType<typeof createLogger>
  alerts: AlertSystem
}

type GoalHandler = (args: GoalHandlerArgs) => Promise<void> | void

const goalHandlers: Record<string, GoalHandler> = {
  discover: async ({ cfg, log }) => {
    const report = await runSetup(cfg, log)
    log.info('discover report', { report })
  },

  setup: async ({ cfg, log }) => {
    const report = await runSetup(cfg, log)
    if (report.imapOk && report.smtpOk) {
      log.info('setup complete', { folders: report.folders.length })
    } else {
      log.error('setup incomplete', {
        recommendations: report.recommendations,
      })
      process.exit(2)
    }
  },

  'check-imap': async ({ cfg, log }) => {
    const report = await runImapCheck(cfg, log)
    log.info('check-imap report', {
      imapOk: report.imapOk,
      authOk: report.authOk,
      folders: report.folders.length,
    })
    if (!report.imapOk) {
      process.exit(2)
    }
  },

  organize: async ({ cfg, ctx, log, alerts }) => {
    const plan = await buildOrganizationPlan(cfg, ctx, log, alerts)
    if (ctx.dryRun) {
      log.info('dry-run organization plan', plan)
      alerts.info(
        'organize',
        'Plan de organización generado en modo dry-run; no se aplicaron cambios.',
        'agent/executor',
        {
          newFolders: plan.newFolders,
          folderProposals: plan.folderProposals.length,
          labelProposals: plan.labelProposals.length,
        },
      )
    } else {
      await applyOrganizationPlan(cfg, plan, log)
      alerts.audit('organize-applied', 'agent/executor', {
        newFolders: plan.newFolders,
        folderProposals: plan.folderProposals.length,
        labelProposals: plan.labelProposals.length,
      })
    }
  },

  monitor: async ({ cfg, ctx, log, alerts }) => {
    const plan = await buildOrganizationPlan(cfg, ctx, log, alerts)
    log.info('monitor/alert plan', {
      newFolders: plan.newFolders,
      folderProposals: plan.folderProposals.length,
      labelProposals: plan.labelProposals.length,
      alerts: plan.alerts.length,
    })
  },

  alert: async ({ cfg, ctx, log, alerts }) => {
    const plan = await buildOrganizationPlan(cfg, ctx, log, alerts)
    log.info('monitor/alert plan', {
      newFolders: plan.newFolders,
      folderProposals: plan.folderProposals.length,
      labelProposals: plan.labelProposals.length,
      alerts: plan.alerts.length,
    })
  },

  'pass-audit': async ({ cfg, ctx, log, alerts }) => {
    if (!cfg.products.pass.enabled) {
      log.error('Proton Pass is not enabled. Set PROTON_PASS_ENABLED=true.')
      process.exit(2)
    }
    const { PassClient } = await import('../pass.js')
    const passClient = new PassClient(
      {
        storeDir: cfg.products.pass.storeDir,
        backend: cfg.products.pass.backend ?? 'pass',
      },
      log,
    )
    const report = await passClient.audit()
    log.info('pass-audit report', {
      storeOk: report.storeOk,
      totalEntries: report.totalEntries,
      weak: report.weakPasswords.length,
      duplicates: report.duplicates.length,
      stale: report.staleEntries.length,
      rotationPlan: report.rotationPlan.length,
      backend: passClient.getBackendBinary(),
    })
    if (ctx.dryRun) {
      log.info('pass-audit rotation plan (dry-run)', {
        items: report.rotationPlan,
      })
    } else {
      // Una auditoría NUNCA escribe: rotar la contraseña ALMACENADA no cambia
      // la del servicio, así que regenerarla aquí invalida la credencial sin
      // rotarla (hallazgo F01). El plan se informa y se aplica fuera del
      // agente, entrada por entrada y con decisión explícita.
      log.warn('pass-audit is read-only; rotationPlan NOT applied', {
        items: report.rotationPlan.length,
      })
    }
    alerts.audit('pass-audit', 'agent/executor', {
      ...report,
      dryRun: ctx.dryRun,
      applied: 0,
    })
  },

  'drive-audit': async ({ cfg, log, alerts }) => {
    const deps = await loadDriveDeps(cfg, log)
    if (!deps) return
    const inv = await deps.auditor.scanInventory(deps.stagingDir)
    const dups = await deps.auditor.findDuplicates(deps.stagingDir)
    const fmt = await deps.auditor.formatReport(deps.stagingDir)
    log.info('drive-audit report', {
      totalFiles: inv.totalFiles,
      totalBytes: inv.totalBytes,
      duplicates: dups.length,
      obsoleteFiles: fmt.obsoleteFiles.length,
    })
    alerts.audit('drive-audit', 'agent/executor', {
      totalFiles: inv.totalFiles,
      duplicates: dups.length,
      obsoleteFiles: fmt.obsoleteFiles.length,
    })
  },

  'drive-organize': async ({ cfg, ctx, log, alerts }) => {
    const deps = await loadDriveDeps(cfg, log)
    if (!deps) return
    const plan = await deps.auditor.buildOrganizePlan(deps.stagingDir)
    if (ctx.dryRun) {
      log.info('drive-organize plan (dry-run)', {
        suggestions: plan.suggestions.length,
        movable: plan.movable,
        blocked: plan.blocked,
      })
      alerts.info(
        'drive-organize',
        'Plan de organización Drive en dry-run',
        'agent/executor',
        { suggestions: plan.suggestions.length, blocked: plan.blocked },
      )
    } else {
      // Mismo motor que `proton_drive_organize`: revalida precondiciones y
      // nunca sobrescribe (hallazgo F02).
      const applied = deps.applyOrganizePlan(deps.stagingDir, plan, log)
      log.info('drive-organize applied', {
        moved: applied.moved,
        skipped: applied.skipped,
        failed: applied.failed,
      })
      alerts.audit('drive-organize-applied', 'agent/executor', {
        moved: applied.moved,
        skipped: applied.skipped,
        failed: applied.failed,
      })
    }
  },

  'drive-list': async ({ cfg, log, alerts }) => {
    const deps = await loadDriveDeps(cfg, log)
    if (!deps) return
    const r = await deps.driveClient.listFiles('/my-files')
    if (!r.ok) {
      log.error('drive-list failed', { error: r.error })
      process.exit(2)
    }
    log.info('drive-list ok', { entries: r.files.length })
    alerts.audit('drive-list', 'agent/executor', { entries: r.files.length })
  },

  'drive-download': async ({ cfg, log, alerts }) => {
    const deps = await loadDriveDeps(cfg, log)
    if (!deps) return
    const r = await deps.driveClient.download('/my-files')
    if (!r.ok) {
      log.error('drive-download failed', { error: r.error })
      process.exit(2)
    }
    log.info('drive-download ok', { localPath: r.localPath })
    alerts.audit('drive-download', 'agent/executor', { localPath: r.localPath })
  },

  'drive-upload': async ({ cfg, log, alerts }) => {
    const deps = await loadDriveDeps(cfg, log)
    if (!deps) return
    const r = await deps.driveClient.upload()
    if (!r.ok) {
      log.error('drive-upload failed', { error: r.error })
      process.exit(2)
    }
    log.info('drive-upload ok', { remotePath: r.remotePath })
    alerts.audit('drive-upload', 'agent/executor', { remotePath: r.remotePath })
  },

  'suite-status': ({ cfg, log }) => {
    log.info('suite status', {
      mail: cfg.products.mail.enabled ? 'enabled' : 'disabled',
      pass: cfg.products.pass.enabled ? 'enabled' : 'disabled',
      calendar: cfg.products.calendar.enabled ? 'enabled (stub)' : 'disabled',
      drive: cfg.products.drive.enabled ? 'enabled (proton-drive CLI)' : 'disabled',
    })
  },

  'suite-manage': async ({ log, alerts }) => {
    log.info('suite-manage: discovering Proton ecosystem binaries')
    const { checkAllBinaries } = await import('../ecosystem/discovery.js')
    const all = checkAllBinaries()
    for (const b of all) {
      const status = b.installed
        ? `installed (${b.version ?? '?'})${b.authenticated !== undefined ? ', auth: ' + b.authenticated : ''}`
        : 'not installed'
      log.info('  ' + b.name + ': ' + status)
    }
    alerts.audit('suite-manage', 'agent/executor', {
      totalBinaries: all.length,
      installed: all.filter((b) => b.installed).length,
      authenticated: all.filter((b) => b.authenticated).length,
    })
  },
}

// ---------------------------------------------------------------------------
// Helpers de carga lazy para dependencias pesadas
// ---------------------------------------------------------------------------

interface DriveDepsResult {
  stagingDir: string
  driveClient: {
    listFiles: (path: string) => Promise<{ ok: boolean; files: Record<string, unknown>[]; error?: string }>
    download: (path: string, local?: string) => Promise<{ ok: boolean; localPath: string; error?: string }>
    upload: (local?: string, remote?: string) => Promise<{ ok: boolean; remotePath: string; error?: string }>
  }
  auditor: {
    scanInventory: (dir: string) => Promise<{ totalFiles: number; totalBytes: number }>
    findDuplicates: (dir: string) => Promise<{ hash: string; size: number; files: { path: string; name: string }[] }[]>
    formatReport: (dir: string) => Promise<{ totalExtensions: number; obsoleteFiles: { name: string; path: string; ext: string; size: number }[] }>
    buildOrganizePlan: (dir: string) => Promise<OrganizePlan>
  }
  applyOrganizePlan: (
    stagingDir: string,
    plan: OrganizePlan,
    log: ReturnType<typeof createLogger>,
  ) => OrganizeApplyResult
}

async function loadDriveDeps(cfg: Config, log: ReturnType<typeof createLogger>): Promise<DriveDepsResult | null> {
  if (!cfg.products.drive.enabled) {
    log.error('Drive is not configured. Set DRIVE_ENABLED=true.')
    process.exit(2)
  }
  const { DriveClient } = await import('../drive.js')
  const { DriveAuditor, applyOrganizePlan } = await import('../drive-audit.js')
  const driveCfg = cfg.products.drive
  const client = new DriveClient(driveCfg, log)
  const auditorInstance = new DriveAuditor(driveCfg.obsoleteExtensions, log)
  return {
    stagingDir: client.stagingDir,
    driveClient: client,
    auditor: auditorInstance,
    applyOrganizePlan,
  } as unknown as DriveDepsResult
}

export { loadConfig }
export type { Config }
