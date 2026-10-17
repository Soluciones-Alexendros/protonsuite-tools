/**
 * Configuración y logger — Proton Suite Agent.
 *
 * **Fachada delgada** que compone los esquemas de producto (extraídos a
 * src/config/*.ts) en un único ConfigSchema y exporta loadConfig /
 * createLogger / resolveBridgeConfig.
 *
 * Filosofía:
 *  - Validación única al arranque con Zod. Si falta algo, el proceso muere
 *    con un error descriptible en vez de explotar en runtime a mitad de una
 *    request.
 *  - Logger que escribe SIEMPRE a stderr. En modo stdio el stdout está
 *    reservado al JSON-RPC de MCP; contaminarlo con texto de log rompería el
 *    protocolo en silencio.
 *  - Niveles estándar (error/warn/info/debug) sin dependencia de librerías
 *    pesadas como pino/winston. Si en el futuro queremos structured logs,
 *    `createLogger` se sustituye sin tocar el resto del código.
 *  - Schema multi-producto: cada producto (mail, pass, calendar, drive) tiene
 *    su bloque de configuración con `enabled` como gate. Los productos no
 *    configurados no se inicializan y sus tools no se registran.
 *
 * **Re-exports from sub-modules:**
 *  - DriveConfigSchema, DriveConfig, parseDriveConfig
 *  - MailBridgeSchema, BridgeConfig, ResolvedBridgeConfig, parseBridgeConfig
 *  - PassConfigSchema, PassConfig, parsePassConfig
 *  - CalendarConfigSchema, CalendarConfig, parseCalendarConfig
 */
import { z } from 'zod'

// Sub-módulos de producto
import { MailBridgeSchema, parseBridgeConfig } from './config/bridge.js'
import type { BridgeConfig, ResolvedBridgeConfig } from './config/bridge.js'
import { CalendarConfigSchema, parseCalendarConfig } from './config/calendar.js'
import type { CalendarConfig } from './config/calendar.js'
import { DriveConfigSchema, parseDriveConfig } from './config/drive.js'
import type { DriveConfig } from './config/drive.js'
import { PassConfigSchema, parsePassConfig } from './config/pass.js'
import type { PassConfig } from './config/pass.js'
import { redact } from './security.js'

// ---------------------------------------------------------------------------
// ConfigSchema — composición de todos los productos + infraestructura.
// ---------------------------------------------------------------------------
const EffectClassSchema = z.enum(['read', 'write', 'destructive', 'admin'])

/** Directorio por defecto de solicitudes y permisos de aprobación. */
export const DEFAULT_APPROVAL_DIR = '.protonsuite/approvals'

/**
 * Directorio de aprobaciones, leído del entorno sin validar el resto de la
 * configuración.
 *
 * Existe para que el comando de aprobación funcione aunque el resto de la
 * configuración esté incompleta: aprobar no debería exigir tener el Bridge
 * configurado.
 */
export function approvalDirFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env['AUTHZ_APPROVAL_DIR'] ?? DEFAULT_APPROVAL_DIR
}

/**
 * Autorización. El bloque es opcional a propósito: cuando falta, el motor
 * aplica sus valores seguros (aplicar la política y exigir aprobación para
 * escribir). Así, olvidarse de configurarlo no deja el servidor abierto.
 */
const AuthzConfigSchema = z.object({
  mode: z.enum(['enforce', 'observe']).default('enforce'),
  actor: z.string().default('operator'),
  approvalDir: z.string().default('.protonsuite/approvals'),
  /** `null` desactiva el diario. Solo para pruebas o perfiles sin disco. */
  journalFile: z.string().nullable().default('logs/authz.jsonl'),
  allow: z.array(EffectClassSchema).default(['read']),
  requireApproval: z
    .array(EffectClassSchema)
    .default(['write', 'destructive', 'admin']),
})
const ConfigSchema = z.object({
  products: z.object({
    mail: z.object({
      enabled: z.boolean().default(true),
      bridge: MailBridgeSchema,
    }),
    pass: PassConfigSchema,
    calendar: CalendarConfigSchema,
    drive: DriveConfigSchema,
  }),
  transport: z.object({
    kind: z.enum(['stdio', 'http']).default('stdio'),
    httpHost: z.string().default('127.0.0.1'),
    httpPort: z.number().int().positive().default(8787),
    authToken: z.string().optional(),
    allowedOrigins: z.array(z.string()).default([]),
  }),
  alerts: z.object({
    webhookUrl: z.url().optional(),
    minSeverity: z
      .enum(['info', 'warning', 'alert', 'critical'])
      .default('warning'),
    logDir: z.string().default('logs'),
    enabled: z.boolean().default(true),
    ntfy: z
      .object({
        url: z.url().optional(),
        topic: z.string().optional(),
        token: z.string().optional(),
      })
      .optional(),
    slack: z
      .object({
        webhookUrl: z.url().optional(),
      })
      .optional(),
    discord: z
      .object({
        webhookUrl: z.url().optional(),
      })
      .optional(),
  }),
  /**
   * Manejo de secretos.
   *
   * `fromModel: false` (por defecto) significa que el modelo NO transporta el
   * secreto principal: las herramientas lo leen de su origen configurado y solo
   * devuelven metadatos. Ponerlo a `true` restaura el comportamiento antiguo y
   * NO es seguro: el secreto acaba en el cliente, en el transporte y en los
   * logs del modelo (hallazgo F06).
   */
  secrets: z.object({ fromModel: z.boolean().default(false) }).optional(),
  agent: z.object({
    dryRun: z.boolean().default(true),
    maxInspectEmails: z.number().int().positive().default(1000),
    minConfidence: z.number().min(0).max(1).default(0.6),
  }),
  authz: AuthzConfigSchema.optional(),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
})


export type Config = z.infer<typeof ConfigSchema>

// ---------------------------------------------------------------------------
// Re-exports de tipos y schemas desde submódulos
// ---------------------------------------------------------------------------
export {
  MailBridgeSchema,
  DriveConfigSchema,
  PassConfigSchema,
  CalendarConfigSchema,
  parseBridgeConfig,
  parseDriveConfig,
  parsePassConfig,
  parseCalendarConfig,
}
export type {
  BridgeConfig,
  ResolvedBridgeConfig,
  DriveConfig,
  PassConfig,
  CalendarConfig,
}

// ---------------------------------------------------------------------------
// resolveBridgeConfig — resuelve BridgeConfig con password JIT.
// Permanece aquí porque depende del tipo Config, que se define en este
// mismo módulo (evita dependencia circular con config/bridge.ts).
// ---------------------------------------------------------------------------
/**
 * Resuelve el BridgeConfig a un ResolvedBridgeConfig con JIT password.
 * Si Pass está habilitado y hay passPath, usa PassClient. Si no, fallback a env var.
 */
export async function resolveBridgeConfig(
  cfg: Config,
  log: {
    debug: (m: string, e?: unknown) => void
    info: (m: string, e?: unknown) => void
    warn?: (m: string, e?: unknown) => void
    error?: (m: string, e?: unknown) => void
  },
): Promise<ResolvedBridgeConfig> {
  const bridge = cfg.products.mail.bridge
  if (cfg.products.pass.enabled && bridge.passPath) {
    const { PassClient } = await import('./pass.js')
    const passLog = {
      debug: log.debug,
      info: log.info,
      warn: log.warn ?? log.debug,
      error: log.error ?? log.info,
    }
    const passClient = new PassClient(
      {
        storeDir: cfg.products.pass.storeDir,
        backend: cfg.products.pass.backend ?? 'pass',
      },
      passLog,
    )
    const passPath = bridge.passPath
    return {
      ...bridge,
      passwordResolver: () => passClient.get(passPath),
    }
  }
  return {
    ...bridge,
    passwordResolver: () => Promise.resolve(bridge.pass),
  }
}

// ---------------------------------------------------------------------------
// Helpers de lectura de env vars
// ---------------------------------------------------------------------------

function readInt(value: string | undefined, defaultValue: number): number {
  return value !== undefined && value !== '' ? Number(value) : defaultValue
}

function readBool(value: string | undefined, defaultValue: boolean): boolean {
  return value !== undefined && value !== '' ? value === 'true' : defaultValue
}

function readCsv(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}

// ---------------------------------------------------------------------------
// Parsers por bloque
// ---------------------------------------------------------------------------

function parseProductsConfig(env: NodeJS.ProcessEnv) {
  return {
    mail: {
      enabled: readBool(env['PROTON_MAIL_ENABLED'], true),
      bridge: parseBridgeConfig(env),
    },
    pass: parsePassConfig(env),
    calendar: parseCalendarConfig(env),
    drive: parseDriveConfig(env),
  }
}

function parseTransportConfig(env: NodeJS.ProcessEnv) {
  return {
    kind: (env['MCP_TRANSPORT'] ?? 'stdio') as 'stdio' | 'http',
    httpHost: env['MCP_HTTP_HOST'] ?? '127.0.0.1',
    httpPort: readInt(env['MCP_HTTP_PORT'], 8787),
    authToken: env['MCP_AUTH_TOKEN'] || undefined,
    allowedOrigins: readCsv(env['MCP_ALLOWED_ORIGINS']),
  }
}

function parseLogLevel(env: NodeJS.ProcessEnv) {
  return (env['LOG_LEVEL'] ?? 'info') as 'error' | 'warn' | 'info' | 'debug'
}

function parseAlertConfig(env: NodeJS.ProcessEnv) {
  const ntfyTopic = env['ALERT_NTFY_TOPIC']?.trim()
  const ntfyUrl = env['ALERT_NTFY_URL']?.trim() || 'https://ntfy.sh'
  const ntfyToken = env['ALERT_NTFY_TOKEN']?.trim()
  return {
    webhookUrl: env['ALERT_WEBHOOK_URL'] || undefined,
    minSeverity: (env['ALERT_MIN_SEVERITY'] ??
      'warning') as Config['alerts']['minSeverity'],
    logDir: env['ALERT_LOG_DIR'] ?? 'logs',
    enabled: readBool(env['ALERTS_ENABLED'], true),
    ...(ntfyTopic
      ? {
          ntfy: {
            url: ntfyUrl,
            topic: ntfyTopic,
            ...(ntfyToken ? { token: ntfyToken } : {}),
          },
        }
      : {}),
  }
}

function parseAgentConfig(env: NodeJS.ProcessEnv) {
  return {
    dryRun: readBool(env['AGENT_DRY_RUN'], true),
    maxInspectEmails: readInt(env['AGENT_MAX_INSPECT_EMAILS'], 1000),
    minConfidence: Number(env['AGENT_MIN_CONFIDENCE'] ?? '0.6'),
  }
}

export function loadConfig(): Config {
  const env = process.env
  const raw = {
    products: parseProductsConfig(env),
    transport: parseTransportConfig(env),
    alerts: parseAlertConfig(env),
    secrets: { fromModel: readBool(env['SECRETS_FROM_MODEL'], false) },
    agent: parseAgentConfig(env),
    authz: parseAuthzConfig(env),
    logLevel: parseLogLevel(env),
  }
  return ConfigSchema.parse(raw)
}

/**
 * Autorización por variables de entorno.
 *
 * `AUTHZ_MODE=observe` deja pasar todo y solo lo anota. NO protege de nada:
 * existe para medir antes de bloquear, nunca para un perfil con datos reales.
 */
function parseAuthzConfig(env: NodeJS.ProcessEnv) {
  const allow = readCsv(env['AUTHZ_ALLOW'])
  const requireApproval = readCsv(env['AUTHZ_REQUIRE_APPROVAL'])
  return {
    mode: (env['AUTHZ_MODE'] ?? 'enforce') as 'enforce' | 'observe',
    actor: env['AUTHZ_ACTOR'] ?? 'operator',
    approvalDir: env['AUTHZ_APPROVAL_DIR'] ?? DEFAULT_APPROVAL_DIR,
    journalFile: env['AUTHZ_JOURNAL_FILE'] ?? 'logs/authz.jsonl',
    ...(allow.length > 0 ? { allow } : {}),
    ...(requireApproval.length > 0 ? { requireApproval } : {}),
  }
}

export function mailBridge(cfg: Config): Config['products']['mail']['bridge'] {
  return cfg.products.mail.bridge
}

export function isDryRun(cfg: Config): boolean {
  return cfg.agent.dryRun
}

/**
 * ¿Se permite que el modelo transporte secretos?
 *
 * Cuando falta la configuración, la respuesta es NO: el valor seguro. Un literal
 * de configuración incompleto no debe abrir la puerta a que el secreto principal
 * circule por el cliente y los logs (hallazgo F06).
 */
export function secretsFromModel(cfg: Config): boolean {
  return cfg.secrets?.fromModel ?? false
}

// -----------------------------------------------------------------------------
// Logger
// -----------------------------------------------------------------------------
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const
export type LogLevel = keyof typeof LEVELS

export function createLogger(level: LogLevel) {
  const threshold = LEVELS[level]
  const write = (lvl: LogLevel, msg: string, extra?: unknown) => {
    if (LEVELS[lvl] > threshold) return
    const ts = new Date().toISOString()
    const tail = extra === undefined ? '' : ` ${safeStringify(extra)}`
    process.stderr.write(`[${ts}] ${lvl.toUpperCase()} ${msg}${tail}\n`)
  }
  return {
    error: (msg: string, extra?: unknown) => {
      write('error', msg, extra)
    },
    warn: (msg: string, extra?: unknown) => {
      write('warn', msg, extra)
    },
    info: (msg: string, extra?: unknown) => {
      write('info', msg, extra)
    },
    debug: (msg: string, extra?: unknown) => {
      write('debug', msg, extra)
    },
  }
}

/**
 * Serializa para el log REDACTANDO antes.
 *
 * Este es el último punto común por el que pasa todo lo que se escribe en
 * stderr, así que es el sitio correcto para la redacción: quien loguee algo con
 * un secreto no tiene que acordarse de limpiarlo (hallazgo F42).
 */
function safeStringify(v: unknown): string {
  try {
    const limpio = redact(v)
    return typeof limpio === 'string' ? limpio : JSON.stringify(limpio)
  } catch {
    return '[no serializable]'
  }
}
