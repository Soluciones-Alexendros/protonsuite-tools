/**
 * Utilidades compartidas de Drive (walk, hash, etc.).
 *
 * Centraliza funciones duplicadas entre DriveClient y DriveAuditor.
 */
import { createHash } from 'node:crypto'
import {
  constants as fsConstants,
  copyFileSync,
  linkSync,
  readFileSync,
  unlinkSync,
} from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Recorre `dir` recursivamente (async), ejecutando `visitor` en cada fichero.
 */
export async function walkDir(
  dir: string,
  visitor: (entryName: string, fullPath: string, statSize: number, statMtime: Date) => Promise<void> | void,
  onError?: (fullPath: string, err: unknown) => void,
): Promise<void> {
  const entries = await readdir(dir)
  for (const entry of entries) {
    const full = resolve(dir, entry)
    try {
      const s = await stat(full)
      if (s.isDirectory()) {
        await walkDir(full, visitor, onError)
      } else {
        await visitor(entry, full, s.size, s.mtime)
      }
    } catch (err) {
      onError?.(full, err)
    }
  }
}

/**
 * Calcula el SHA-256 de un fichero.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Cuenta ficheros y bytes de un directorio (async walk).
 */
export async function countFiles(dir: string): Promise<{ files: number; bytes: number }> {
  const totals = { files: 0, bytes: 0 }
  await walkDir(dir, (_entry, _full, size) => {
    totals.files++
    totals.bytes += size
  })
  return totals
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
