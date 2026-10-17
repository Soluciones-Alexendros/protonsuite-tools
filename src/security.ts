/**
 * Redacción de secretos.
 *
 * Un secreto que aparece en un log, en una alerta o en un mensaje de error ya
 * está fuera de control: los ficheros de log se copian, se adjuntan a incidencias
 * y se suben a servicios. Por eso la redacción va en el ÚLTIMO punto común
 * (el logger), no en cada sitio que decide loguear algo: así el que se olvide no
 * abre un agujero.
 *
 * Dos mecanismos, porque un secreto se filtra de dos maneras:
 *  1. Por el NOMBRE del campo (`password`, `token`, …).
 *  2. Dentro de un texto libre (una URL con `?token=…`, una cabecera Bearer, una
 *     cadena base64 larga que viene de un `get`).
 */
const SAFE_PATH_RE = /^[a-zA-Z0-9._/-]+$/

/** Nombres de campo cuyo VALOR nunca debe salir. */
const SENSITIVE_SEGMENTS = new Set([
  'pass',
  'passwd',
  'password',
  'passphrase',
  'secret',
  'secrets',
  'token',
  'tokens',
  'credential',
  'credentials',
  'cookie',
  'cookies',
  'totp',
  'otp',
  'pin',
])

const SENSITIVE_JOINED = new Set([
  'apikey',
  'privatekey',
  'accesskey',
  'sessionkey',
  'accesstoken',
  'refreshtoken',
  'bridgepass',
  'bridgepassword',
])

/**
 * ¿El nombre del campo delata que su valor es secreto?
 *
 * Se parte el nombre por separadores y por mayúsculas, y se busca un segmento
 * sensible. Así `bridgePassword` y `MCP_AUTH_TOKEN` se detectan, pero
 * `authenticated` o `authOk` NO: son indicadores, no credenciales, y redactarlos
 * rompería la lectura de la traza sin ganar nada.
 */
export function isSensitiveKey(key: string): boolean {
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (segments.some((s) => SENSITIVE_SEGMENTS.has(s))) return true
  return SENSITIVE_JOINED.has(segments.join(''))
}

/** Marcador único, para poder afirmar en las pruebas que se sustituyó algo. */
export const REDACTED = '[redactado]'

export const SecretSafety = {
  validateSafePath(path: string): boolean {
    return SAFE_PATH_RE.test(path)
  },

  /** Representación corta y no reversible de un valor. */
  sanitizeForLog(value: unknown): string {
    if (typeof value === 'string') {
      if (value.length <= 4) return '***'
      return value.slice(0, 2) + '***' + value.slice(-2)
    }
    return '***'
  },
}

/** Oculta material sensible embebido en texto libre. */
export function redactText(text: string): string {
  return (
    text
      // Bloques PEM
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        REDACTED,
      )
      // Cabeceras de autorización
      .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`)
      // `clave=valor` o `clave: valor` en texto suelto (URLs incluidas)
      .replace(
        /\b(password|passwd|passphrase|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|authorization)\b(\s*[=:]\s*)("?)([^\s"&,;]+)/gi,
        `$1$2$3${REDACTED}`,
      )
      // Cabeceras pegadas en un mensaje
      .replace(
        /((?:authorization|proxy-authorization|x-api-key)\s*:\s*)\S+/gi,
        `$1${REDACTED}`,
      )
  )
}

/**
 * Copia un valor sustituyendo lo sensible, sin mutar el original.
 *
 * Recorre arrays y objetos anidados: un secreto a tres niveles se filtra igual
 * que en el primero. La detección de ciclos mira solo la RAMA actual, no todo lo
 * visto: si el mismo objeto aparece en dos ramas hermanas, se redacta en las
 * dos. Marcarlo como «circular» ahí sería mentir y dejaría la segunda rama sin
 * revisar.
 */
export function redact(value: unknown, ancestors: readonly object[] = []): unknown {
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (ancestors.includes(value)) return '[circular]'

  const rama = [...ancestors, value]

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, rama))
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
    }
  }

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(item, rama)
  }
  return out
}

export interface SecretLogger {
  debug: (m: string, d?: unknown) => void
  info: (m: string, d?: unknown) => void
  warn: (m: string, d?: unknown) => void
  error: (m: string, d?: unknown) => void
}

/**
 * Logger para el material que toca secretos.
 *
 * Además de marcar los mensajes con `[sec]`, REDACTAR el payload. Antes solo
 * ponía el prefijo: cualquiera que pasara un objeto con un campo sensible lo
 * escribía tal cual en stderr (hallazgo F42).
 */
export function makeSecretLogger(base: SecretLogger): SecretLogger {
  const envuelve =
    (fn: (m: string, d?: unknown) => void) => (m: string, d?: unknown) => {
      fn(`[sec] ${m}`, d === undefined ? undefined : redact(d))
    }
  return {
    debug: envuelve(base.debug.bind(base)),
    info: envuelve(base.info.bind(base)),
    warn: envuelve(base.warn.bind(base)),
    error: envuelve(base.error.bind(base)),
  }
}
