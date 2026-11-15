/**
 * Schema de configuración del transporte MCP (stdio | http).
 *
 * Extraído de src/config.ts para reducir el tamaño de la fachada principal.
 * Sin dependencias circulares — importa zod y los helpers de env.
 */
import { z } from 'zod'
import { readCsv, readInt } from './env.js'

/** Cupo de sesiones MCP a la vez. */
export const DEFAULT_MAX_SESSIONS = 32
/** Peticiones MCP en curso a la vez. */
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 64

export const TransportConfigSchema = z.object({
  kind: z.enum(['stdio', 'http']).default('stdio'),
  httpHost: z.string().default('127.0.0.1'),
  httpPort: z.number().int().positive().default(8787),
  authToken: z.string().optional(),
  allowedOrigins: z.array(z.string()).default([]),
  /**
   * Nombres de host admitidos en la cabecera `Host`. Vacío = se derivan del
   * host configurado. Existe para frenar el «DNS rebinding»: una página web
   * maliciosa puede resolver un nombre a 127.0.0.1 y hablar con el servidor
   * local, pero mandará SU nombre en `Host` (hallazgo F27).
   */
  allowedHosts: z.array(z.string()).optional(),
  /** Cupo de sesiones MCP simultáneas. Evita que crezcan sin freno (F23). */
  maxSessions: z.number().int().positive().optional(),
  /** Peticiones en curso a la vez. Más allá, se rechaza con 503 (F23). */
  maxConcurrentRequests: z.number().int().positive().optional(),
})

export type TransportConfig = z.infer<typeof TransportConfigSchema>

/** Parsea la config de transporte desde env vars. */
export function parseTransportConfig(env: NodeJS.ProcessEnv) {
  return {
    kind: (env['MCP_TRANSPORT'] ?? 'stdio') as 'stdio' | 'http',
    httpHost: env['MCP_HTTP_HOST'] ?? '127.0.0.1',
    httpPort: readInt(env['MCP_HTTP_PORT'], 8787),
    authToken: env['MCP_AUTH_TOKEN'] || undefined,
    allowedOrigins: readCsv(env['MCP_ALLOWED_ORIGINS']),
    allowedHosts: readCsv(env['MCP_ALLOWED_HOSTS']),
    maxSessions: readInt(env['MCP_MAX_SESSIONS'], DEFAULT_MAX_SESSIONS),
    maxConcurrentRequests: readInt(
      env['MCP_MAX_CONCURRENT'],
      DEFAULT_MAX_CONCURRENT_REQUESTS,
    ),
  }
}
