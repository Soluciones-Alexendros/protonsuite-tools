/**
 * Schema de configuración de la autorización (ADR-0009).
 *
 * Extraído de src/config.ts para reducir el tamaño de la fachada principal.
 * Sin dependencias circulares — importa zod y los helpers de env.
 */
import { z } from 'zod'
import { readCsv } from './env.js'

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
export const AuthzConfigSchema = z.object({
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

export type AuthzConfig = z.infer<typeof AuthzConfigSchema>

/**
 * Autorización por variables de entorno.
 *
 * `AUTHZ_MODE=observe` deja pasar todo y solo lo anota. NO protege de nada:
 * existe para medir antes de bloquear, nunca para un perfil con datos reales.
 */
export function parseAuthzConfig(env: NodeJS.ProcessEnv) {
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
