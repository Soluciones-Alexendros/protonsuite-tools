/**
 * Schema de configuración de alertas.
 *
 * Extraído de src/config.ts para reducir el tamaño de la fachada principal.
 * Sin dependencias circulares — importa zod y los helpers de env.
 */
import { z } from 'zod'
import { readBool } from './env.js'

export const AlertsConfigSchema = z.object({
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
})

export type AlertsConfig = z.infer<typeof AlertsConfigSchema>

/** Parsea la config de alertas desde env vars. */
export function parseAlertConfig(env: NodeJS.ProcessEnv) {
  const ntfyTopic = env['ALERT_NTFY_TOPIC']?.trim()
  const ntfyUrl = env['ALERT_NTFY_URL']?.trim() || 'https://ntfy.sh'
  const ntfyToken = env['ALERT_NTFY_TOKEN']?.trim()
  return {
    webhookUrl: env['ALERT_WEBHOOK_URL'] || undefined,
    minSeverity: (env['ALERT_MIN_SEVERITY'] ??
      'warning') as AlertsConfig['minSeverity'],
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
