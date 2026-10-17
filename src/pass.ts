/**
 * Proton Pass client via `pass` o `gopass` CLI (password-store compatible).
 *
 * Principios de seguridad — heredados del skill protonpass:
 *  1. Los valores NUNCA se loguean. `get()` retorna el secreto solo a callers
 *     internos que lo marcan como sensible.
 *  2. Los valores NUNCA se devuelven al chat. Las tools MCP confirman
 *     `{found:true}` sin el secreto.
 *  3. Los valores se inyectan sin pasar por stdout. Si un cliente necesita un
 *     secreto, se inyecta vía variable de entorno o file descriptor.
 *  4. Sin rastro en logs ni auditoría. Las entradas no aparecen en `logs/`.
 *  5. `execFile` sin shell: sin interpolación de variables ni inyección de
 *     comandos. Los paths se validan contra un charset seguro.
 *
 * Backends: `pass` (https://www.passwordstore.org/) o `gopass`
 * (`PROTON_PASS_BACKEND=gopass`). La superficie de PassClient se mantiene.
 */
import { execFile } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { readdir, stat, copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'

export type PassBackend = 'pass' | 'gopass'

export type PassExecFn = (
  args: string[],
  opts: { env: NodeJS.ProcessEnv; input?: string },
) => Promise<string>

/** Entradas sin rotación reciente (mtime del .gpg). Default: 365 días. */
const STALE_MS_DEFAULT = 365 * 24 * 60 * 60 * 1000

function createPassExec(binary: string): PassExecFn {
  return async (args, opts) =>
    new Promise((resolve, reject) => {
      const child = execFile(binary, args, { env: opts.env })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (d) => (stdout += d))
      child.stderr?.on('data', (d) => (stderr += d))
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
          return
        }
        reject(new Error(stderr.trim() || `${binary} exited with code ${code}`))
      })
      child.on('error', reject)
      if (opts.input) {
        child.stdin?.write(opts.input)
        child.stdin?.end()
      }
    })
}

const SAFE_PATH_RE = /^[a-zA-Z0-9._/-]+$/

export interface PassLogger {
  debug: (m: string, e?: unknown) => void
  info: (m: string, e?: unknown) => void
  warn: (m: string, e?: unknown) => void
  error: (m: string, e?: unknown) => void
}

export interface PassClientOptions {
  storeDir: string
  /** CLI backend. Default: `pass`. */
  backend?: PassBackend
  /** Max age before an entry is marked stale (ms). Default: 365d. */
  staleAfterMs?: number
}

export interface PassRotationItem {
  path: string
  reason: 'weak' | 'duplicate' | 'stale'
  action: 'regenerate'
}

export interface PassAuditResult {
  storeOk: boolean
  totalEntries: number
  weakPasswords: string[]
  duplicates: string[]
  staleEntries: string[]
  rotationPlan: PassRotationItem[]
  recommendations: string[]
  [key: string]: unknown
}

export class PassClient {
  private readonly storeDir: string
  private readonly binary: string
  private readonly staleAfterMs: number
  private readonly exec: PassExecFn

  constructor(
    opts: PassClientOptions,
    private readonly log: PassLogger,
    exec?: PassExecFn,
  ) {
    this.storeDir = opts.storeDir.startsWith('~')
      ? resolvePath(homedir(), opts.storeDir.slice(2))
      : resolvePath(opts.storeDir)
    this.binary = opts.backend === 'gopass' ? 'gopass' : 'pass'
    this.staleAfterMs = opts.staleAfterMs ?? STALE_MS_DEFAULT
    this.exec = exec ?? createPassExec(this.binary)
  }

  /** Nombre del binario CLI (`pass` | `gopass`). */
  getBackendBinary(): string {
    return this.binary
  }

  // ---------------------------------------------------------------------------
  // Operaciones del store
  // ---------------------------------------------------------------------------

  /** Lista entradas del store (solo nombres, NUNCA valores). */
  async list(filter?: string): Promise<string[]> {
    const entries = await readdir(this.storeDir, { recursive: true })
    const paths = entries
      .filter((f) => f.endsWith('.gpg'))
      .map((f) => f.replace(/\.gpg$/, ''))
    this.log.debug('pass list ok', { count: paths.length })
    if (filter) {
      return paths.filter((p) => p.includes(filter))
    }
    return paths
  }

  /**
   * Obtiene un secreto del store.
   * NUNCA se loguea el valor. Solo se retorna al caller para inyección interna
   * (ej. resolver PROTON_BRIDGE_PASS desde Pass). Las tools MCP usan
   * `getAndInject`, no este método directamente.
   */
  async get(path: string): Promise<string> {
    this.validatePath(path)
    this.log.debug('pass get', { path })
    try {
      const stdout = await this.exec(['show', path], {
        env: { ...process.env, PASSWORD_STORE_DIR: this.storeDir },
      })
      // SAFETY: el `?? ''` aquí es defensivo contra `noUncheckedIndexedAccess`
      // ([0] pasa a `string | undefined`). Por ECMAScript spec, `String.prototype.split`
      // siempre retorna array de longitud ≥ 1 (incluso `''.split('\n') === ['']`), así que
      // la rama `?? ''` NO se ejecuta nunca en runtime. v8 la marca como uncovered;
      // la imposibilidad es runtime (ECMAScript), no tooling — no añadir mocks que
      // falseen coverage; mantener como defensive fall-through.
      //
      // NO reemplazar con `!` (bloqueado por `@typescript-eslint/no-non-null-assertion`)
      // ni con `as string` (bloqueado por `@typescript-eslint/non-nullable-type-assertion-style`).
      // Si se relaja `no-non-null-assertion`, usar `!`; si se relajan ambas
      // (`no-non-null-assertion` + `non-nullable-type-assertion-style`),
      // preferir `as string` (más explícito). Cualquiera elimina el fallback `?? ''`,
      // con lo que v8 deja de contarlo como rama y `pass.ts` sube a 100% branches.
      return (stdout.trim().split('\n')[0] ?? '')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('not in the password store') ||
        msg.includes('not found')
      ) {
        throw new PassError(`Entry not found: ${path}`, 'NOT_FOUND')
      }
      throw new PassError(`Failed to read entry: ${msg}`, 'READ_ERROR')
    }
  }

  /**
   * ¿Existe ya la entrada? Consulta el ciphertext en disco; NUNCA descifra.
   */
  async exists(path: string): Promise<boolean> {
    this.validatePath(path)
    try {
      await stat(joinPath(this.storeDir, `${path}.gpg`))
      return true
    } catch {
      return false
    }
  }

  /**
   * Copia de seguridad del ciphertext antes de sobrescribir una entrada.
   * Copia bytes cifrados: no descifra y no expone el valor.
   */
  private async backupBeforeOverwrite(path: string): Promise<string> {
    const src = joinPath(this.storeDir, `${path}.gpg`)
    const dst = `${src}.bak.${Date.now()}`
    await copyFile(src, dst)
    this.log.warn('pass backup before overwrite', { path })
    return dst
  }

  /**
   * Genera una contraseña segura y la guarda en el store.
   * Devuelve metadata (path, length) sin el valor generado.
   *
   * NO-CLOBBER: si la entrada ya existe, lanza `PassError('EXISTS')` salvo que
   * se pase `{ overwrite: true }`. Sobrescribir exige decisión explícita y
   * deja copia de seguridad del ciphertext anterior.
   */
  async generate(
    path: string,
    length = 24,
    opts: { overwrite?: boolean } = {},
  ): Promise<{ path: string; length: number; backupPath?: string }> {
    this.validatePath(path)
    const alreadyExists = await this.exists(path)
    if (alreadyExists && opts.overwrite !== true) {
      throw new PassError(
        `Entry already exists: ${path}. Overwrite requires explicit opt-in.`,
        'EXISTS',
      )
    }
    const backupPath = alreadyExists
      ? await this.backupBeforeOverwrite(path)
      : undefined
    this.log.info('pass generate', { path, length, overwrite: alreadyExists })
    const password = randomBytes(Math.ceil(length * 0.75))
      .toString('base64')
      .slice(0, length)
    await this.exec(['insert', '--multiline', '--force', path], {
      env: { ...process.env, PASSWORD_STORE_DIR: this.storeDir },
      input: password,
    })
    return backupPath === undefined
      ? { path, length }
      : { path, length, backupPath }
  }

  /**
   * Verifica la salud del store: ¿está accesible? ¿tiene entradas?
   */
  async health(): Promise<{ ok: boolean; entries: number; error?: string }> {
    try {
      const entries = await this.list()
      return { ok: true, entries: entries.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, entries: 0, error: msg }
    }
  }

  // ---------------------------------------------------------------------------
  // Auditoría de fortaleza
  // ---------------------------------------------------------------------------

  /**
   * Audita el vault: contraseñas débiles, duplicados, entradas sin rotación.
   * Las contraseñas se evalúan localmente (nunca se envían a servicios externos).
   */
  async audit(): Promise<PassAuditResult> {
    const healthResult = await this.health()
    if (!healthResult.ok) {
      return {
        storeOk: false,
        totalEntries: 0,
        weakPasswords: [],
        duplicates: [],
        staleEntries: [],
        rotationPlan: [],
        recommendations: [
          `Store no accesible: ${healthResult.error ?? 'error desconocido'}`,
        ],
      }
    }

    const entries = await this.list()
    const weakPasswords: string[] = []
    const seen = new Map<string, string>() // hash → primer path
    const duplicates: string[] = []
    const duplicatePaths = new Set<string>()
    const staleEntries: string[] = []
    const now = Date.now()

    for (const entry of entries) {
      try {
        const st = await stat(joinPath(this.storeDir, `${entry}.gpg`))
        if (now - st.mtimeMs > this.staleAfterMs) {
          staleEntries.push(entry)
        }
      } catch {
        // sin mtime → no marcar stale
      }

      let value: string
      try {
        value = await this.get(entry)
      } catch {
        continue
      }

      // Heurística de fortaleza: < 12 chars o sin mezcla de tipos
      const hasUpper = /[A-Z]/.test(value)
      const hasLower = /[a-z]/.test(value)
      const hasDigit = /[0-9]/.test(value)
      const hasSpecial = /[^A-Za-z0-9]/.test(value)
      const typeCount = [hasUpper, hasLower, hasDigit, hasSpecial].filter(
        Boolean,
      ).length

      const isShort = value.length < 12
      const isLowDiversity = typeCount < 2

      if (isShort || isLowDiversity) {
        weakPasswords.push(entry)
      }

      // Detección de duplicados por hash simple
      const hash = this.simpleHash(value)
      const existing = seen.get(hash)
      if (existing) {
        duplicates.push(`${entry} (duplicado de ${existing})`)
        duplicatePaths.add(entry)
      } else {
        seen.set(hash, entry)
      }
    }

    const rotationPlan: PassRotationItem[] = []
    const planned = new Set<string>()
    for (const path of weakPasswords) {
      if (planned.has(path)) continue
      planned.add(path)
      rotationPlan.push({ path, reason: 'weak', action: 'regenerate' })
    }
    for (const path of duplicatePaths) {
      if (planned.has(path)) continue
      planned.add(path)
      rotationPlan.push({ path, reason: 'duplicate', action: 'regenerate' })
    }
    for (const path of staleEntries) {
      if (planned.has(path)) continue
      planned.add(path)
      rotationPlan.push({ path, reason: 'stale', action: 'regenerate' })
    }

    const recommendations: string[] = []
    if (weakPasswords.length > 0) {
      recommendations.push(
        `${weakPasswords.length} contraseñas débiles detectadas (<12 caracteres o poca variedad). Rotarlas en el servicio de origen: 'proton_pass_generate' no las sobrescribe.`,
      )
    }
    if (duplicates.length > 0) {
      recommendations.push(
        `${duplicates.length} contraseñas duplicadas detectadas. Revisar y unificar entradas.`,
      )
    }
    if (staleEntries.length > 0) {
      recommendations.push(
        `${staleEntries.length} entradas sin rotación reciente (mtime > ${Math.round(this.staleAfterMs / 86_400_000)}d). Incluidas en rotationPlan.`,
      )
    }
    if (rotationPlan.length > 0) {
      recommendations.push(
        `Plan de rotación: ${rotationPlan.length} entradas. La auditoría NUNCA escribe. Cambiar la contraseña almacenada no cambia la del servicio: rota cada credencial en su origen.`,
      )
    }

    return {
      storeOk: true,
      totalEntries: entries.length,
      weakPasswords,
      duplicates,
      staleEntries,
      rotationPlan,
      recommendations,
    }
  }

  /**
   * Inserta una nueva entrada en el store.
   * Loguea solo el path, NUNCA el valor.
   *
   * NO-CLOBBER: igual que `generate`, sobrescribir exige `{ overwrite: true }`
   * y deja copia de seguridad del ciphertext anterior.
   */
  async insert(
    path: string,
    secret: string,
    opts: { overwrite?: boolean } = {},
  ): Promise<{ ok: true; path: string; backupPath?: string }> {
    this.validatePath(path)
    const alreadyExists = await this.exists(path)
    if (alreadyExists && opts.overwrite !== true) {
      throw new PassError(
        `Entry already exists: ${path}. Overwrite requires explicit opt-in.`,
        'EXISTS',
      )
    }
    const backupPath = alreadyExists
      ? await this.backupBeforeOverwrite(path)
      : undefined
    this.log.info('pass insert', { path, overwrite: alreadyExists })
    await this.exec(['insert', '--multiline', '--force', path], {
      env: { ...process.env, PASSWORD_STORE_DIR: this.storeDir },
      input: secret,
    })
    return backupPath === undefined
      ? { ok: true, path }
      : { ok: true, path, backupPath }
  }

  /**
   * Elimina una entrada del store.
   */
  async remove(path: string): Promise<{ ok: true; path: string }> {
    this.validatePath(path)
    this.log.info('pass remove', { path })
    await this.exec(['rm', '-f', path], {
      env: { ...process.env, PASSWORD_STORE_DIR: this.storeDir },
    })
    return { ok: true, path }
  }

  /**
   * Mueve/renombra una entrada del store.
   */
  async move(
    from: string,
    to: string,
  ): Promise<{ ok: true; from: string; to: string }> {
    this.validatePath(from)
    this.validatePath(to)
    this.log.info('pass move', { from, to })
    await this.exec(['mv', from, to], {
      env: { ...process.env, PASSWORD_STORE_DIR: this.storeDir },
    })
    return { ok: true, from, to }
  }

  /**
   * Copia una entrada del store.
   */
  async copy(
    src: string,
    dst: string,
  ): Promise<{ ok: true; src: string; dst: string }> {
    this.validatePath(src)
    this.validatePath(dst)
    this.log.info('pass copy', { src, dst })
    await this.exec(['cp', src, dst], {
      env: { ...process.env, PASSWORD_STORE_DIR: this.storeDir },
    })
    return { ok: true, src, dst }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Valida que un path de entrada no contenga caracteres peligrosos. */
  private validatePath(path: string): void {
    if (path.includes('..') || !SAFE_PATH_RE.test(path)) {
      throw new PassError(`Invalid entry path: ${path}`, 'INVALID_PATH')
    }
  }

  /** Hash para detección de duplicados (SHA-256, primeros 16 hex chars). */
  private simpleHash(s: string): string {
    return createHash('sha256').update(s).digest('hex').slice(0, 16)
  }
}

export class PassError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'READ_ERROR' | 'INVALID_PATH' | 'EXISTS',
  ) {
    super(message)
    this.name = 'PassError'
  }
}
