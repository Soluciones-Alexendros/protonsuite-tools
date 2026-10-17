/**
 * T-SEC-01 — Ningún secreto sale por el log.
 *
 * El log es el sitio por donde más se filtran secretos: se copia a ficheros, se
 * adjunta a incidencias y se sube a servicios. Estas pruebas recorren los cuatro
 * niveles y las formas habituales de colarse: campo sensible, anidado, dentro de
 * un texto libre y dentro de un error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../src/config.js'
import { isSensitiveKey, makeSecretLogger, redact, redactText, REDACTED } from '../../src/security.js'

const SECRETO = 'SUPER-SECRETO-QUE-NO-DEBE-SALIR'

let escrito: string[]
let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  escrito = []
  spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: unknown) => {
      escrito.push(String(chunk))
      return true
    }) as never)
})

afterEach(() => {
  spy.mockRestore()
})

const salida = () => escrito.join('')

describe('logger · la redacción es la última barrera', () => {
  it('ningún nivel escribe un campo sensible', () => {
    const log = createLogger('debug')
    log.error('e', { password: SECRETO })
    log.warn('w', { token: SECRETO })
    log.info('i', { secret: SECRETO })
    log.debug('d', { apiKey: SECRETO })

    expect(salida()).not.toContain(SECRETO)
    expect(salida()).toContain(REDACTED)
  })

  it('tapa el secreto aunque esté anidado o en una lista', () => {
    const log = createLogger('info')
    log.info('anidado', {
      nivel1: { nivel2: { nivel3: { password: SECRETO } } },
      lista: [{ secret: SECRETO }],
    })

    expect(salida()).not.toContain(SECRETO)
  })

  it('tapa credenciales embebidas en texto libre', () => {
    const log = createLogger('info')
    log.info('url', { url: `https://x.test/?token=${SECRETO}` })
    log.info('cabecera', { headers: `Authorization: Bearer ${SECRETO}` })

    expect(salida()).not.toContain(SECRETO)
  })

  it('tapa el secreto que viaja dentro de un mensaje de error', () => {
    const log = createLogger('info')
    log.info('fallo', new Error(`no se pudo autenticar con Bearer ${SECRETO}`))
    log.info('fallo plano', `token=${SECRETO}`)

    expect(salida()).not.toContain(SECRETO)
  })

  it('no tapa lo que no es secreto: el log sigue sirviendo', () => {
    const log = createLogger('info')
    log.info('estado', { authenticated: false, authOk: true, user: 'a@proton.me' })

    const out = salida()
    expect(out).toContain('authenticated')
    expect(out).toContain('a@proton.me')
    expect(out).not.toContain(REDACTED)
  })
})

describe('logger de secretos · [sec]', () => {
  it('redacta además de marcar', () => {
    const base = createLogger('info')
    const sec = makeSecretLogger(base)
    sec.info('almacén', { password: SECRETO, ruta: '/tmp/x' })

    const out = salida()
    expect(out).toContain('[sec]')
    expect(out).not.toContain(SECRETO)
    expect(out).toContain('/tmp/x')
  })
})

describe('redacción · piezas sueltas', () => {
  it('reconoce nombres de campo que delatan un secreto', () => {
    for (const key of [
      'password',
      'BRIDGE_PASS',
      'bridgePassword',
      'MCP_AUTH_TOKEN',
      'api_key',
      'apiKey',
      'privateKey',
      'accessToken',
      'totp',
      'cookie',
    ]) {
      expect(isSensitiveKey(key), `${key} debería ser sensible`).toBe(true)
    }
  })

  it('no marca indicadores que no son credenciales', () => {
    for (const key of ['authenticated', 'authOk', 'author', 'usuario', 'path', 'ok']) {
      expect(isSensitiveKey(key), `${key} no debería ser sensible`).toBe(false)
    }
  })

  it('no muta el objeto original', () => {
    const original = { password: SECRETO }
    redact(original)
    expect(original.password).toBe(SECRETO)
  })

  it('corta las referencias circulares en vez de colgarse', () => {
    const a: Record<string, unknown> = { nombre: 'a' }
    a['self'] = a
    expect(JSON.stringify(redact(a))).toContain('[circular]')
  })

  it('tapa bloques de clave privada', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'
    expect(redactText(pem)).toBe(REDACTED)
  })

  it('un error se convierte en algo legible y sin secreto', () => {
    const r = redact(new Error(`fallo con Bearer ${SECRETO}`)) as Record<string, unknown>
    expect(r['name']).toBe('Error')
    expect(String(r['message'])).not.toContain(SECRETO)
  })
})

describe('redacción · entradas que no son texto ni objetos', () => {
  it('deja pasar números, booleanos y null sin tocarlos', () => {
    expect(redact(42)).toBe(42)
    expect(redact(true)).toBe(true)
    expect(redact(null)).toBeNull()
    expect(redact(undefined)).toBeUndefined()
  })

  it('no inventa nada en una cadena que no contiene secretos', () => {
    expect(redactText('todo normal, sin nada que tapar')).toBe(
      'todo normal, sin nada que tapar',
    )
  })

  it('recorre listas de objetos', () => {
    const r = redact([{ password: SECRETO }, { ok: true }]) as unknown[]
    expect((r[0] as Record<string, unknown>)['password']).toBe(REDACTED)
    expect((r[1] as Record<string, unknown>)['ok']).toBe(true)
  })

  it('un secreto compartido dos veces se trata en cada sitio', () => {
    const compartido = { token: SECRETO }
    const r = redact({ a: compartido, b: compartido }) as Record<string, unknown>
    expect((r['a'] as Record<string, unknown>)['token']).toBe(REDACTED)
    expect((r['b'] as Record<string, unknown>)['token']).toBe(REDACTED)
  })
})
