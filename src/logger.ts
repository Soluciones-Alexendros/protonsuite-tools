/**
 * Logger — Proton Suite Agent.
 *
 * Escribe SIEMPRE a stderr. En modo stdio el stdout está reservado al
 * JSON-RPC de MCP; contaminarlo con texto de log rompería el protocolo en
 * silencio.
 *
 * Niveles estándar (error/warn/info/debug) sin dependencia de librerías
 * pesadas como pino/winston. Si en el futuro queremos structured logs,
 * `createLogger` se sustituye sin tocar el resto del código.
 */
import { redact } from './security.js'

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
