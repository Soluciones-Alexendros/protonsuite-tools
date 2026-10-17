/**
 * Utilidades compartidas de Drive (walk, hash, etc.).
 *
 * Centraliza funciones duplicadas entre DriveClient y DriveAuditor.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  constants as fsConstants,
  copyFileSync,
  linkSync,
  unlinkSync,
} from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

/** Límites del recorrido. Sin ellos, un árbol hostil cuelga el servidor. */
export interface WalkLimits {
  /** Profundidad máxima de carpetas. */
  readonly maxDepth?: number;
  /** Número máximo de ficheros visitados. */
  readonly maxFiles?: number;
  /** Bytes totales máximos recorridos. */
  readonly maxBytes?: number;
  /** Para cancelar a mitad. */
  readonly signal?: AbortSignal;
}

export const DEFAULT_WALK_LIMITS: Required<Omit<WalkLimits, 'signal'>> = {
  maxDepth: 32,
  maxFiles: 20_000,
  maxBytes: 2 * 1024 * 1024 * 1024,
};

export interface WalkStats {
  files: number;
  bytes: number;
  /** Motivo por el que se paró antes de terminar, si pasó. */
  truncatedBy?: 'max-depth' | 'max-files' | 'max-bytes' | 'aborted';
}

/**
 * Recorre `dir` de forma ACOTADA (hallazgo F25).
 *
 * Antes usaba `stat`, que sigue los enlaces simbólicos: un enlace a `/` o a un
 * ancestro provocaba un recorrido infinito o fuera del sitio previsto, y no
 * había tope de profundidad, ficheros ni bytes. Ahora:
 *
 *  - `lstat`: no se siguen enlaces, así que no se sale ni se entra en bucle.
 *  - Tope de profundidad, de número de ficheros y de bytes.
 *  - Se recuerda lo ya visitado por dispositivo+inodo, por si acaso.
 *  - Se puede cancelar con `AbortSignal`.
 *
 * Cuando se corta, `truncatedBy` lo dice. No se finge que el recorrido fue
 * completo.
 */
export async function walkDir(
  dir: string,
  visitor: (entryName: string, fullPath: string, statSize: number, statMtime: Date) => Promise<void> | void,
  onError?: (fullPath: string, err: unknown) => void,
  limits: WalkLimits = {},
): Promise<WalkStats> {
  const maxDepth = limits.maxDepth ?? DEFAULT_WALK_LIMITS.maxDepth;
  const maxFiles = limits.maxFiles ?? DEFAULT_WALK_LIMITS.maxFiles;
  const maxBytes = limits.maxBytes ?? DEFAULT_WALK_LIMITS.maxBytes;
  const stats: WalkStats = { files: 0, bytes: 0 };
  const visitados = new Set<string>();

  async function paso(actual: string, profundidad: number): Promise<boolean> {
    if (limits.signal?.aborted) {
      stats.truncatedBy = 'aborted';
      return false;
    }
    if (profundidad > maxDepth) {
      stats.truncatedBy = 'max-depth';
      return false;
    }

    let entries: string[];
    try {
      entries = await readdir(actual);
    } catch (err) {
      onError?.(actual, err);
      return true;
    }

    for (const entry of entries) {
      const full = resolve(actual, entry);
      try {
        // lstat, NO stat: no seguir enlaces.
        const s = await lstat(full);

        // Un enlace se registra como fichero, no se atraviesa.
        if (s.isSymbolicLink()) {
          if (stats.files >= maxFiles) {
            stats.truncatedBy = 'max-files';
            return false;
          }
          stats.files++;
          await visitor(entry, full, s.size, s.mtime);
          continue;
        }

        if (s.isDirectory()) {
          const clave = `${s.dev}:${s.ino}`;
          if (visitados.has(clave)) continue;
          visitados.add(clave);
          const seguimos = await paso(full, profundidad + 1);
          if (!seguimos) return false;
          continue;
        }

        if (stats.files >= maxFiles) {
          stats.truncatedBy = 'max-files';
          return false;
        }
        if (stats.bytes + s.size > maxBytes) {
          stats.truncatedBy = 'max-bytes';
          return false;
        }

        stats.files++;
        stats.bytes += s.size;
        await visitor(entry, full, s.size, s.mtime);
      } catch (err) {
        onError?.(full, err);
      }
    }
    return true;
  }

  await paso(dir, 0);
  return stats;
}

/**
 * SHA-256 de un fichero, en streaming.
 *
 * Antes leía el fichero ENTERO en memoria de forma síncrona: un fichero grande
 * bloqueaba el bucle de eventos y podía agotar la memoria (hallazgo F25). En
 * streaming el consumo es constante.
 */
export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Cuenta ficheros y bytes de un directorio (async walk).
 */
export async function countFiles(dir: string): Promise<{ files: number; bytes: number }> {
  const stats = await walkDir(dir, () => {
    /* solo se cuentan; no hay nada que hacer por fichero */
  })
  return { files: stats.files, bytes: stats.bytes }
}

/** Se lanza cuando el destino ya existe y NO se debe sobrescribir. */
export class DestinationExistsError extends Error {
  constructor(public readonly destination: string) {
    super(`Destination already exists: ${destination}`)
    this.name = 'DestinationExistsError'
  }
}

/**
 * Mueve un fichero SIN sobrescribir el destino.
 *
 * En el mismo filesystem usa `link` + `unlink`: el enlace falla con EEXIST si
 * el destino existe, así que la comprobación y el efecto son una sola
 * operación atómica (sin ventana TOCTOU). Entre filesystems cae a
 * `copyFile` con `COPYFILE_EXCL`, que también falla si el destino existe.
 */
export function moveNoClobber(src: string, dst: string): void {
  try {
    linkSync(src, dst)
    unlinkSync(src)
    return
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new DestinationExistsError(dst)
    }
    if (code !== 'EXDEV') {
      throw err
    }
  }
  try {
    copyFileSync(src, dst, fsConstants.COPYFILE_EXCL)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DestinationExistsError(dst)
    }
    throw err
  }
  unlinkSync(src)
}
