// ---------------------------------------------------------------------------
// Types (formerly agent/types.ts — merged here to reduce file count)
// ---------------------------------------------------------------------------

export type AgentGoal =
  | 'discover'
  | 'setup'
  | 'organize'
  | 'monitor'
  | 'alert'
  | 'check-imap'
  | 'pass-audit'
  | 'suite-status'
  | 'suite-manage'
  | 'drive-audit'
  | 'drive-organize'
  | 'drive-list'
  | 'drive-download'
  | 'drive-upload'

export interface GoalContext {
  goal: AgentGoal
  dryRun: boolean
  maxInspectEmails: number
  minConfidence: number
}

export interface SetupReport {
  bridgeReachable: boolean
  imapOk: boolean
  smtpOk: boolean
  authOk: boolean
  folders: string[]
  recommendations: string[]
}

export interface OrganizationPlan {
  [x: string]: unknown
  newFolders: string[]
  folderProposals: FolderProposal[]
  labelProposals: LabelProposal[]
  alerts: {
    severity: 'info' | 'warning' | 'alert' | 'critical'
    category: string
    message: string
    uids: number[]
  }[]
}

export interface FolderProposal {
  path: string
  reason: string
  emails: number[]
  suggestedLabels?: string[]
}

export interface LabelProposal {
  name: string
  reason: string
  emails: number[]
}

export interface PassAuditReport {
  storeOk: boolean
  totalEntries: number
  weakPasswords: string[]
  duplicates: string[]
  staleEntries: string[]
  recommendations: string[]
}

export interface SuiteStatusReport {
  mail: {
    available: boolean
    connected?: boolean
    mailboxes?: number
    unread?: number
    error?: string
  }
  pass: {
    available: boolean
    connected?: boolean
    entries?: number
    error?: string
  }
  calendar: { available: boolean; reason?: string }
  drive: { available: boolean; reason?: string }
}

export const AGENT_GOALS: readonly AgentGoal[] = [
  'discover',
  'setup',
  'check-imap',
  'organize',
  'monitor',
  'alert',
  'pass-audit',
  'suite-status',
  'suite-manage',
  'drive-audit',
  'drive-organize',
  'drive-list',
  'drive-download',
  'drive-upload',
]

export function parseGoal(value: string | undefined): AgentGoal {
  const g = (value ?? 'setup') as AgentGoal
  if (!AGENT_GOALS.includes(g)) {
    throw new Error(
      `Unknown agent goal: ${value}. Allowed: ${AGENT_GOALS.join(', ')}`,
    )
  }
  return g
}

export function buildGoalContext(
  goal: AgentGoal,
  cfg: { dryRun: boolean; maxInspectEmails: number; minConfidence: number },
): GoalContext {
  return {
    goal,
    dryRun: cfg.dryRun,
    maxInspectEmails: cfg.maxInspectEmails,
    minConfidence: cfg.minConfidence,
  }
}

export function describeGoal(goal: AgentGoal): string {
  const map: Record<AgentGoal, string> = {
    discover: 'Descubre el estado actual del buzón sin realizar cambios.',
    setup:
      'Verifica la conectividad con Bridge y autenticación, reportando estado.',
    'check-imap':
      'Verifica únicamente la conexión IMAP con Bridge sin enviar email.',
    organize:
      'Analiza el buzón y propone/crea carpetas, etiquetas y archivado.',
    monitor:
      'Revisa el buzón buscando alertas de seguridad sin realizar cambios.',
    alert: 'Revisa y emite alertas para correos de alto riesgo.',
    'pass-audit':
      'Audita el vault Pass (pass|gopass): fortaleza, duplicados, stale y plan de rotación. Dry-run por defecto.',
    'suite-status':
      'Reporte unificado del estado de todos los productos configurados (Mail, Pass, Calendar, Drive).',
    'suite-manage':
      'Descubre, verifica y reporta el estado de todos los binarios del ecosistema Proton (Bridge, pass, proton-drive, gpg). Sugiere instalaci\u00f3n si faltan.',
    'drive-audit':
      'Escanea el staging de ProtonDrive: inventario, duplicados, formatos obsoletos. Read-only.',
    'drive-organize':
      'Analiza y reorganiza archivos en el staging por tipo. Dry-run por defecto.',
    'drive-list':
      'Lista archivos en Proton Drive (CLI oficial proton-drive filesystem list).',
    'drive-download':
      'Descarga archivos de Proton Drive al staging (CLI oficial proton-drive filesystem download).',
    'drive-upload':
      'Sube el staging a Proton Drive (CLI oficial proton-drive filesystem upload).',
  }
  return map[goal]
}
