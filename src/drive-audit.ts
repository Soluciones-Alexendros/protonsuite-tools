import { existsSync, mkdirSync } from 'node:fs'
import { basename, extname, relative, dirname, resolve } from 'node:path'
import { DestinationExistsError, hashFile, moveNoClobber, walkDir } from './drive-utils.js'

export interface InventoryReport {
  totalFiles: number
  totalBytes: number
  byExt: Record<string, number>
  byDir: Record<string, number>
  files: {
    name: string
    path: string
    ext: string
    size: number
    modified: Date
  }[]
}

export interface DuplicateEntry {
  hash: string
  size: number
  files: { path: string; name: string }[]
}

export interface FormatReport {
  totalExtensions: number
  extensions: string[]
  obsoleteExtensions: string[]
  obsoleteFiles: { name: string; path: string; ext: string; size: number }[]
  noExtension: number
}

export type OrganizeAction = 'move' | 'rename' | 'reject'

/** Estrategia cuando el destino está ocupado o dos orígenes colisionan. */
export type OrganizeStrategy = 'reject' | 'rename'

export interface OrganizeSuggestion {
  action: OrganizeAction
  from: string
  to: string
  reason: string
  /** Motivo del bloqueo cuando `action === 'reject'`. */
  blockedBy?: 'destination-exists' | 'plan-collision'
}

export interface OrganizePlan {
  strategy: OrganizeStrategy
  suggestions: OrganizeSuggestion[]
  /** Sugerencias aplicables (action move/rename). */
  movable: number
  /** Sugerencias bloqueadas (action reject). */
  blocked: number
}

/** Resultado por acción. `failed` nunca se silencia. */
export interface OrganizeActionResult {
  from: string
  to: string
  status: 'moved' | 'skipped' | 'failed'
  reason?: string
}

export interface OrganizeApplyResult {
  moved: number
  skipped: number
  failed: number
  results: OrganizeActionResult[]
}

export class DriveAuditor {
  constructor(
    private obsoleteExtensions: string[],
    private log: {
      debug: (m: string, d?: unknown) => void
      info: (m: string, d?: unknown) => void
      error: (m: string, d?: unknown) => void
    },
  ) {}

  async scanInventory(stagingDir: string): Promise<InventoryReport> {
    const files: InventoryReport['files'] = []
    let totalBytes = 0

    if (existsSync(stagingDir)) {
      await walkDir(
        stagingDir,
        (entry, full, size, mtime) => {
          totalBytes += size
          files.push({
            name: entry,
            path: relative(stagingDir, full),
            ext: extname(entry).toLowerCase(),
            size,
            modified: mtime,
          })
        },
        (full, err) => {
          this.log.error(`drive-audit: skip ${full}`, {
            error: (err as Error).message,
          })
        },
      )
    }

    const byExt: Record<string, number> = {}
    const byDir: Record<string, number> = {}
    for (const f of files) {
      byExt[f.ext] = (byExt[f.ext] ?? 0) + 1
      const dir = dirname(f.path)
      byDir[dir === '.' ? '/' : dir] = (byDir[dir === '.' ? '/' : dir] ?? 0) + 1
    }

    return { totalFiles: files.length, totalBytes, byExt, byDir, files }
  }

  async findDuplicates(stagingDir: string): Promise<DuplicateEntry[]> {
    const hashMap = new Map<string, DuplicateEntry>()
    if (existsSync(stagingDir)) {
      await walkDir(
        stagingDir,
        async (entry, full, size) => {
          if (size > 0) {
            // En streaming: antes leía el fichero entero en memoria.
            const hash = await hashFile(full)
            const dup = hashMap.get(hash) ?? { hash, size, files: [] }
            hashMap.set(hash, dup)
            dup.files.push({ path: relative(stagingDir, full), name: entry })
          }
        },
        (full, err) => {
          this.log.error(`drive-audit: skip ${full}`, {
            error: (err as Error).message,
          })
        },
      )
    }

    return Array.from(hashMap.values()).filter((e) => e.files.length > 1)
  }

  async formatReport(stagingDir: string): Promise<FormatReport> {
    const inv = await this.scanInventory(stagingDir)
    const obsoleteFiles = inv.files.filter((f) =>
      this.obsoleteExtensions.includes(f.ext),
    )
    const extensions = [...new Set(inv.files.map((f) => f.ext))]
      .filter(Boolean)
      .sort()
    const noExtension = inv.files.filter((f) => !f.ext).length

    return {
      totalExtensions: extensions.length,
      extensions,
      obsoleteExtensions: [...this.obsoleteExtensions],
      obsoleteFiles: obsoleteFiles.map((f) => ({
        name: f.name,
        path: f.path,
        ext: f.ext,
        size: f.size,
      })),
      noExtension,
    }
  }

  /** Mapa extensión → carpeta destino de la organización por tipo. */
  private static readonly EXT_DIRS: Record<string, string> = {
    '.md': 'docs',
    '.txt': 'docs',
    '.doc': 'docs/old',
    '.pdf': 'docs',
    '.jpg': 'images',
    '.jpeg': 'images',
    '.png': 'images',
    '.gif': 'images',
    '.svg': 'images',
    '.mp4': 'media',
    '.mov': 'media',
    '.avi': 'media',
    '.mp3': 'audio',
    '.wav': 'audio',
    '.flac': 'audio',
    '.zip': 'archives',
    '.tar': 'archives',
    '.gz': 'archives',
    '.csv': 'data',
    '.json': 'data',
    '.xml': 'data',
  }

  /**
   * Construye el plan de organización con análisis GLOBAL de colisiones.
   *
   * Se reservan los destinos sugeridos y se comprueba tanto la colisión
   * dentro del propio plan (dos orígenes homónimos) como el destino ya
   * ocupado en disco. Por defecto la estrategia es `reject` (no-clobber
   * estricto); `rename` desambigua en vez de bloquear. Nunca se propone
   * sobrescribir.
   */
  async buildOrganizePlan(
    stagingDir: string,
    opts: { strategy?: OrganizeStrategy } = {},
  ): Promise<OrganizePlan> {
    const strategy: OrganizeStrategy = opts.strategy ?? 'reject'
    const inv = await this.scanInventory(stagingDir)
    const suggestions: OrganizeSuggestion[] = []
    const reserved = new Set<string>()

    for (const f of inv.files) {
      const targetDir = DriveAuditor.EXT_DIRS[f.ext]
      if (!targetDir || dirname(f.path) === targetDir) continue

      const desired = `${targetDir}/${f.name}`
      const collides = reserved.has(desired) || existsSync(resolve(stagingDir, desired))
      if (!collides) {
        reserved.add(desired)
        suggestions.push({
          action: 'move',
          from: f.path,
          to: desired,
          reason: `Move ${f.ext} file to ${targetDir}/`,
        })
        continue
      }

      const blockedBy = reserved.has(desired) ? 'plan-collision' : 'destination-exists'
      if (strategy === 'reject') {
        suggestions.push({
          action: 'reject',
          from: f.path,
          to: desired,
          reason: `Destination unavailable in ${targetDir}/ (${blockedBy}); not overwriting`,
          blockedBy,
        })
        continue
      }

      const unique = DriveAuditor.uniqueDestination(desired, reserved, stagingDir)
      reserved.add(unique)
      suggestions.push({
        action: 'rename',
        from: f.path,
        to: unique,
        reason: `Move ${f.ext} file to ${targetDir}/ as ${basename(unique)} (${blockedBy})`,
        blockedBy,
      })
    }

    const movable = suggestions.filter((s) => s.action !== 'reject').length
    return {
      strategy,
      suggestions,
      movable,
      blocked: suggestions.length - movable,
    }
  }

  /** Añade sufijo ` (n)` antes de la extensión hasta hallar un destino libre. */
  private static uniqueDestination(
    desired: string,
    reserved: Set<string>,
    stagingDir: string,
  ): string {
    const ext = extname(desired)
    const stem = desired.slice(0, desired.length - ext.length)
    let n = 2
    let candidate = `${stem} (${n})${ext}`
    while (reserved.has(candidate) || existsSync(resolve(stagingDir, candidate))) {
      n++
      candidate = `${stem} (${n})${ext}`
    }
    return candidate
  }
}

/**
 * Motor ÚNICO de aplicación de planes de organización, compartido por la
 * herramienta MCP y por el CLI del agente.
 *
 * Revalida las precondiciones inmediatamente antes de cada efecto, mueve sin
 * sobrescribir (`moveNoClobber`) y devuelve un resultado explícito por acción.
 * Un fallo intermedio NO aborta el resto ni se confunde con éxito.
 */
export function applyOrganizePlan(
  stagingDir: string,
  plan: OrganizePlan,
  log?: { warn: (m: string, d?: unknown) => void; error: (m: string, d?: unknown) => void },
): OrganizeApplyResult {
  const results: OrganizeActionResult[] = []

  for (const s of plan.suggestions) {
    if (s.action === 'reject') {
      results.push({
        from: s.from,
        to: s.to,
        status: 'skipped',
        reason: s.blockedBy ?? 'rejected',
      })
      continue
    }

    const src = resolve(stagingDir, s.from)
    const dst = resolve(stagingDir, s.to)
    try {
      // Revalidación justo antes del efecto: entre plan y aplicación el
      // filesystem puede haber cambiado.
      if (!existsSync(src)) {
        results.push({ from: s.from, to: s.to, status: 'skipped', reason: 'source-missing' })
        continue
      }
      mkdirSync(dirname(dst), { recursive: true })
      moveNoClobber(src, dst)
      results.push({ from: s.from, to: s.to, status: 'moved' })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      log?.error('drive-organize: move failed', { from: s.from, to: s.to, reason })
      results.push({
        from: s.from,
        to: s.to,
        status: 'failed',
        reason:
          err instanceof DestinationExistsError ? 'destination-exists' : reason,
      })
    }
  }

  const count = (status: OrganizeActionResult['status']) =>
    results.filter((r) => r.status === status).length
  const skipped = count('skipped')
  const failed = count('failed')
  if (skipped > 0 || failed > 0) {
    log?.warn('drive-organize finished with non-applied actions', {
      skipped,
      failed,
      moved: count('moved'),
    })
  }

  return { moved: count('moved'), skipped, failed, results }
}
