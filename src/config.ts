/**
 * Configuración — Proton Suite Agent.
 *
 * **Fachada delgada** que compone los esquemas de producto e infraestructura
 * (extraídos a `src/config/*.ts`) en un único `ConfigSchema` y exporta
 * `loadConfig`, `resolveBridgeConfig` y los accessors de uso común.
 *
 * El logger vive en `src/logger.ts` y se re-exporta aquí por compatibilidad.
 *
 * Filosofía:
 *  - Validación única al arranque con Zod. Si falta algo, el proceso muere
 *    con un error descriptible en vez de explotar en runtime a mitad de una
 *    request.
 *  - Schema multi-producto: cada producto (mail, pass, calendar, drive) tiene
 *    su bloque de configuración con `enabled` como gate. Los productos no
 *    configurados no se inicializan y sus tools no se registran.
 *
 * **Re-exports from sub-modules:**
 *  - DriveConfigSchema, DriveConfig, parseDriveConfig
 *  - MailBridgeSchema, BridgeConfig, ResolvedBridgeConfig, parseBridgeConfig
 *  - PassConfigSchema, PassConfig, parsePassConfig
 *  - CalendarConfigSchema, CalendarConfig, parseCalendarConfig
 *  - TransportConfigSchema, TransportConfig, parseTransportConfig, DEFAULT_*
 *  - AlertsConfigSchema, AlertsConfig, parseAlertConfig
 *  - AgentConfigSchema, AgentConfig, parseAgentConfig
 *  - AuthzConfigSchema, AuthzConfig, parseAuthzConfig, approvalDirFromEnv
 *  - createLogger, LogLevel (src/logger.ts)
 */
import { z } from 'zod'
// Sub-módulos de producto e infraestructura
import { AgentConfigSchema, parseAgentConfig } from './config/agent.js'
import type { AgentConfig } from './config/agent.js'
import { AlertsConfigSchema, parseAlertConfig } from './config/alerts.js'
import type { AlertsConfig } from './config/alerts.js'
import {
  approvalDirFromEnv,
  AuthzConfigSchema,
  DEFAULT_APPROVAL_DIR,
  parseAuthzConfig,
} from './config/authz.js'
import type { AuthzConfig } from './config/authz.js'
import { MailBridgeSchema, parseBridgeConfig } from './config/bridge.js'
import type { BridgeConfig, ResolvedBridgeConfig } from './config/bridge.js'
import { CalendarConfigSchema, parseCalendarConfig } from './config/calendar.js'
import type { CalendarConfig } from './config/calendar.js'
import { DriveConfigSchema, parseDriveConfig } from './config/drive.js'
import type { DriveConfig } from './config/drive.js'
import { readBool } from './config/env.js'
import { PassConfigSchema, parsePassConfig } from './config/pass.js'
import type { PassConfig } from './config/pass.js'
import {
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  DEFAULT_MAX_SESSIONS,
  parseTransportConfig,
  TransportConfigSchema,
} from './config/transport.js'
import type { TransportConfig } from './config/transport.js'
import { createLogger } from './logger.js'
import type { LogLevel } from './logger.js'

// ---------------------------------------------------------------------------
// ConfigSchema — composición de todos los productos + infraestructura.
// ---------------------------------------------------------------------------
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
  transport: TransportConfigSchema,
  alerts: AlertsConfigSchema,
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
  agent: AgentConfigSchema,
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
  TransportConfigSchema,
  AlertsConfigSchema,
  AgentConfigSchema,
  AuthzConfigSchema,
  parseBridgeConfig,
  parseDriveConfig,
  parsePassConfig,
  parseCalendarConfig,
  parseTransportConfig,
  parseAlertConfig,
  parseAgentConfig,
  parseAuthzConfig,
  approvalDirFromEnv,
  DEFAULT_APPROVAL_DIR,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  createLogger,
}
export type {
  BridgeConfig,
  ResolvedBridgeConfig,
  DriveConfig,
  PassConfig,
  CalendarConfig,
  TransportConfig,
  AlertsConfig,
  AgentConfig,
  AuthzConfig,
  LogLevel,
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
    const { createPassClient } = await import('./pass.js')
    const passLog = {
      debug: log.debug,
      info: log.info,
      warn: log.warn ?? log.debug,
      error: log.error ?? log.info,
    }
    const passClient = createPassClient(cfg.products.pass, passLog)
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
// Parsers por bloque (composición de los parseXConfig de cada sub-módulo)
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

function parseLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  return (env['LOG_LEVEL'] ?? 'info') as LogLevel
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
