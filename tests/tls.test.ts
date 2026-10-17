/**
 * T-TLS-01 — Certificado, CA y downgrade (hallazgo F34).
 *
 * Lo que había: `tlsInsecure` venía a `true`, así que la validación del
 * certificado estaba desactivada sin que nadie lo hubiera decidido; la CA que
 * prometían los documentos no existía en el código; y IMAP no exigía STARTTLS,
 * con el riesgo de downgrade que la propia librería documenta.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTlsOptions,
  readCa,
  resetTlsWarnings,
  TlsConfigError,
} from '../src/tls.js'

let dir: string
let log: { warn: ReturnType<typeof vi.fn> }

const PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIBkTCB+wIJAJ000000000000000000000000000000000000000000000',
  '-----END CERTIFICATE-----',
].join('\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tls-test-'))
  log = { warn: vi.fn() }
  resetTlsWarnings()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function escribirPem(contenido = PEM): string {
  const ruta = join(dir, 'bridge-ca.pem')
  writeFileSync(ruta, contenido)
  return ruta
}

describe('opciones TLS', () => {
  it('con la validación desactivada, avisa en voz alta', () => {
    const opts = buildTlsOptions({ tlsInsecure: true }, log)

    expect(opts.rejectUnauthorized).toBe(false)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('no se valida el certificado')
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('PROTON_BRIDGE_CA_PATH')
  })

  it('el aviso se da una vez, no en cada reconexión', () => {
    buildTlsOptions({ tlsInsecure: true }, log)
    buildTlsOptions({ tlsInsecure: true }, log)
    buildTlsOptions({ tlsInsecure: true }, log)

    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('con la validación activada, no avisa de nada', () => {
    const opts = buildTlsOptions({ tlsInsecure: false }, log)

    expect(opts.rejectUnauthorized).toBe(true)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('con CA configurada, la incluye y se puede validar', () => {
    const opts = buildTlsOptions({ tlsInsecure: false, caPath: escribirPem() }, log)

    expect(opts.rejectUnauthorized).toBe(true)
    expect(opts.ca).toEqual([PEM])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('sin ruta de CA, no añade el campo', () => {
    expect(buildTlsOptions({ tlsInsecure: false }, log).ca).toBeUndefined()
    expect(buildTlsOptions({ tlsInsecure: false, caPath: '   ' }, log).ca).toBeUndefined()
  })
})

describe('lectura de la CA', () => {
  it('una CA ilegible es un ERROR, no un silencio', () => {
    // Lo peligroso sería seguir sin validar; por eso se falla en voz alta.
    expect(() => readCa(join(dir, 'no-existe.pem'))).toThrow(TlsConfigError)
    expect(() => readCa(join(dir, 'no-existe.pem'))).toThrow(/No se pudo leer la CA/)
  })

  it('exige ruta absoluta', () => {
    expect(() => readCa('bridge-ca.pem')).toThrow(/ruta absoluta/)
  })

  it('rechaza un fichero que no es un PEM de certificado', () => {
    const ruta = join(dir, 'no-es-pem.txt')
    writeFileSync(ruta, 'esto no es un certificado')
    expect(() => readCa(ruta)).toThrow(/no parece un PEM/)
  })
})
