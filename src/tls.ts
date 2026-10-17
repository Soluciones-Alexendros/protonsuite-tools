/**
 * Opciones TLS para las conexiones a Bridge.
 *
 * Estado del que veníamos (hallazgo F34):
 *  - `tlsInsecure` venía a `true` por defecto, así que `rejectUnauthorized`
 *    salía `false`: **la validación del certificado estaba desactivada** sin que
 *    nadie lo hubiera decidido.
 *  - Los documentos prometían pinear la CA de Bridge, y el propio comentario del
 *    código la dejaba «en el roadmap»: la variable no existía.
 *  - IMAP no exigía STARTTLS. La librería lo dice en su documentación: sin
 *    pedirlo explícitamente, «puede exponer la conexión a un ataque de
 *    downgrade».
 *
 * Aquí se junta todo eso: se lee la CA si está configurada, se avisa —una vez—
 * cuando la validación queda desactivada, y se falla en voz alta si la CA
 * configurada no se puede leer (en vez de seguir sin validar, que sería lo
 * peligroso).
 */
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface TlsSource {
  /** Si es `true`, no se valida el certificado del servidor. */
  readonly tlsInsecure: boolean;
  /** Ruta a un PEM con la CA de Bridge. */
  readonly caPath?: string | undefined;
}

export interface TlsOptions {
  readonly rejectUnauthorized: boolean;
  readonly ca?: string[];
}

export interface TlsLogger {
  warn: (message: string, data?: unknown) => void;
}

/** Evita repetir el aviso en cada reconexión. */
const yaAvisado = new Set<string>();

export class TlsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TlsConfigError';
  }
}

/**
 * Construye las opciones TLS.
 *
 * Lanza `TlsConfigError` si hay una CA configurada y no se puede leer: seguir
 * sin ella dejaría la conexión sin validar, que es justo lo que se quería
 * evitar al configurarla.
 */
export function buildTlsOptions(source: TlsSource, log: TlsLogger): TlsOptions {
  const ca = readCa(source.caPath);
  const rejectUnauthorized = !source.tlsInsecure;

  if (!rejectUnauthorized) {
    const clave = source.caPath ?? '(sin CA)';
    if (!yaAvisado.has(clave)) {
      yaAvisado.add(clave);
      log.warn(
        'TLS: no se valida el certificado del servidor (PROTON_BRIDGE_TLS_INSECURE=true). ' +
          'Cualquiera que se ponga en medio puede leer la conversación. ' +
          'Configura PROTON_BRIDGE_CA_PATH con la CA de Bridge y pon PROTON_BRIDGE_TLS_INSECURE=false.',
      );
    }
  }

  return ca === undefined
    ? { rejectUnauthorized }
    : { rejectUnauthorized, ca: [ca] };
}

/** Lee el PEM de la CA. `undefined` si no hay ruta configurada. */
export function readCa(caPath: string | undefined): string | undefined {
  if (caPath === undefined || caPath.trim().length === 0) return undefined;

  if (!isAbsolute(caPath)) {
    throw new TlsConfigError(
      `PROTON_BRIDGE_CA_PATH debe ser una ruta absoluta: ${caPath}`,
    );
  }

  let contenido: string;
  try {
    contenido = readFileSync(caPath, 'utf8');
  } catch (err) {
    throw new TlsConfigError(
      `No se pudo leer la CA de Bridge en ${caPath}: ${(err as Error).message}. ` +
        'No se continúa sin validar: corrige la ruta o quita la variable.',
    );
  }

  if (!contenido.includes('-----BEGIN CERTIFICATE-----')) {
    throw new TlsConfigError(
      `El fichero ${caPath} no parece un PEM de certificado.`,
    );
  }
  return contenido;
}

/** Solo para pruebas: olvida los avisos ya emitidos. */
export function resetTlsWarnings(): void {
  yaAvisado.clear();
}
