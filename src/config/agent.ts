/**
 * Schema de configuración del agente (goals, dry-run, límites).
 *
 * Extraído de src/config.ts para reducir el tamaño de la fachada principal.
 * Sin dependencias circulares — importa zod, constants y los helpers de env.
 */
import { z } from 'zod'
import {
  AGENT_DEFAULT_MAX_INSPECT,
  AGENT_DEFAULT_MIN_CONFIDENCE,
} from '../constants.js'
import { readBool, readInt } from './env.js'

export const AgentConfigSchema = z.object({
  dryRun: z.boolean().default(true),
  maxInspectEmails: z
    .number()
    .int()
    .positive()
    .default(AGENT_DEFAULT_MAX_INSPECT),
  minConfidence: z.number().min(0).max(1).default(AGENT_DEFAULT_MIN_CONFIDENCE),
})

export type AgentConfig = z.infer<typeof AgentConfigSchema>

/** Parsea la config del agente desde env vars. */
export function parseAgentConfig(env: NodeJS.ProcessEnv) {
  return {
    dryRun: readBool(env['AGENT_DRY_RUN'], true),
    maxInspectEmails: readInt(
      env['AGENT_MAX_INSPECT_EMAILS'],
      AGENT_DEFAULT_MAX_INSPECT,
    ),
    minConfidence: Number(
      env['AGENT_MIN_CONFIDENCE'] ?? AGENT_DEFAULT_MIN_CONFIDENCE,
    ),
  }
}
