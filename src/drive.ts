/**
 * Proton Drive client — wraps the official Proton Drive CLI.
 *
 * Las operaciones de Drive se delegan al binario `proton-drive`
 * (descargado de proton.me/support/drive-cli). Esta clase base ejecuta
 * comandos sobre el CLI, parsea la salida JSON y normaliza errores.
 * Las tools MCP y los agent goals construyen encima de ella.
 *
 * La autenticación es responsabilidad del usuario: debe ejecutar
 * `proton-drive auth login` una vez antes de usar las herramientas.
 * El CLI persiste el token localmente (típicamente en ~/.config).
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IDriveClient } from './clients/interfaces.js'
import { DRIVE_EXEC_MAX_BUFFER } from './constants.js'
import { withDrivePathLocks } from './drive-mutex.js'
import { countFiles } from './drive-utils.js'

export interface DriveConfig {
  cliBin: string
  stagingDir: string
  obsoleteExtensions: string[]
}

export interface DriveListEntry {
  name?: string
  path?: string
  size?: number
  type?: string
  modified?: string
}

export interface DriveListResult {
  ok: boolean
  files: DriveListEntry[]
  raw: string
  error?: string
}

export interface DownloadResult {
  ok: boolean
  remotePath: string
  localPath: string
  error?: string
}

export interface UploadResult {
  ok: boolean
  localPath: string
  remotePath: string
  error?: string
}

export interface ShareResult {
  ok: boolean
  remotePath: string
  userEmail: string
  error?: string
}

export interface DriveStatus {
  ok: boolean
  configured: boolean
  authenticated?: boolean
  stagingExists: boolean
  stagingFiles?: number
  stagingBytes?: number
  cliPath: string
  error?: string
}

export class DriveClient implements IDriveClient {
  constructor(
    public opts: DriveConfig,
    private log: {
      debug: (m: string, d?: unknown) => void
      info: (m: string, d?: unknown) => void
      error: (m: string, d?: unknown) => void
    },
  ) {}

  get stagingDir(): string {
    return resolve(this.opts.stagingDir.replace(/^~/, process.env['HOME'] ?? ''))
  }

  execCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolvePromise, reject) => {
      execFile(
        this.opts.cliBin,
        args,
        { maxBuffer: DRIVE_EXEC_MAX_BUFFER },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `proton-drive error: ${err.message}\nstderr: ${stderr}`,
              ),
            )
            return
          }
          resolvePromise({ stdout, stderr })
        },
      )
    })
  }

  checkDeps(): { ok: boolean; version?: string; error?: string } {
    try {
      const version = execFileSync(this.opts.cliBin, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
      return { ok: true, version }
    } catch (err) {
      return {
        ok: false,
        error: `proton-drive not found: ${(err as Error).message}`,
      }
    }
  }

  async listFiles(remotePath: string): Promise<DriveListResult> {
    try {
      this.log.info('drive listFiles', { remotePath })
      const { stdout } = await this.execCli([
        'filesystem',
        'list',
        remotePath,
        '--json',
      ])
      const parsed: unknown = JSON.parse(stdout)
      const files = this.normalizeListOutput(parsed)
      return { ok: true, files, raw: stdout }
    } catch (err) {
      const msg = (err as Error).message
      this.log.error('drive listFiles failed', { error: msg, remotePath })
      return { ok: false, files: [], raw: '', error: msg }
    }
  }

  async download(
    remotePath: string,
    localPath?: string,
  ): Promise<DownloadResult> {
    return withDrivePathLocks([remotePath], async () => {
      try {
        const staging = localPath ?? this.stagingDir
        if (!existsSync(staging)) mkdirSync(staging, { recursive: true })
        this.log.info('drive download', { remotePath, localPath: staging })
        await this.execCli(['filesystem', 'download', remotePath, staging])
        return { ok: true, remotePath, localPath: staging }
      } catch (err) {
        const msg = (err as Error).message
        this.log.error('drive download failed', { error: msg, remotePath })
        return {
          ok: false,
          remotePath,
          localPath: localPath ?? this.stagingDir,
          error: msg,
        }
      }
    })
  }

  async upload(localPath?: string, remotePath?: string): Promise<UploadResult> {
    const target = remotePath ?? '/my-files'
    return withDrivePathLocks([target], async () => {
      try {
        const staging = localPath ?? this.stagingDir
        this.log.info('drive upload', { localPath: staging, remotePath: target })
        await this.execCli(['filesystem', 'upload', staging, target])
        return { ok: true, localPath: staging, remotePath: target }
      } catch (err) {
        const msg = (err as Error).message
        this.log.error('drive upload failed', { error: msg, remotePath })
        return {
          ok: false,
          localPath: localPath ?? this.stagingDir,
          remotePath: target,
          error: msg,
        }
      }
    })
  }

  async share(remotePath: string, userEmail: string): Promise<ShareResult> {
    try {
      this.log.info('drive share', { remotePath, userEmail })
      await this.execCli(['sharing', 'invite', '--user', userEmail, remotePath])
      return { ok: true, remotePath, userEmail }
    } catch (err) {
      const msg = (err as Error).message
      this.log.error('drive share failed', {
        error: msg,
        remotePath,
        userEmail,
      })
      return { ok: false, remotePath, userEmail, error: msg }
    }
  }

  async status(): Promise<DriveStatus> {
    const staging = this.stagingDir
    const stagingExists = existsSync(staging)
    let stagingFiles: number | undefined
    let stagingBytes: number | undefined
    if (stagingExists) {
      const totals = await countFiles(staging)
      stagingFiles = totals.files
      stagingBytes = totals.bytes
    }
    let authenticated: boolean | undefined
    try {
      await this.execCli(['auth', 'status'])
      authenticated = true
    } catch {
      authenticated = false
    }
    return {
      ok: authenticated && stagingExists,
      configured: true,
      authenticated,
      stagingExists,
      ...(stagingFiles !== undefined ? { stagingFiles } : {}),
      ...(stagingBytes !== undefined ? { stagingBytes } : {}),
      cliPath: this.opts.cliBin,
    }
  }

  async moveFiles(
    from: string,
    to: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return withDrivePathLocks([from, to], async () => {
      try {
        this.log.info('drive moveFiles', { from, to })
        await this.execCli(['filesystem', 'mv', from, to])
        return { ok: true }
      } catch (err) {
        const msg = (err as Error).message
        this.log.error('drive moveFiles failed', { error: msg, from, to })
        return { ok: false, error: msg }
      }
    })
  }

  async copyFiles(
    from: string,
    to: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      this.log.info('drive copyFiles', { from, to })
      await this.execCli(['filesystem', 'cp', from, to])
      return { ok: true }
    } catch (err) {
      const msg = (err as Error).message
      this.log.error('drive copyFiles failed', { error: msg, from, to })
      return { ok: false, error: msg }
    }
  }

  async mkdir(remotePath: string): Promise<{ ok: boolean; error?: string }> {
    try {
      this.log.info('drive mkdir', { remotePath })
      await this.execCli(['filesystem', 'mkdir', remotePath])
      return { ok: true }
    } catch (err) {
      const msg = (err as Error).message
      this.log.error('drive mkdir failed', { error: msg, remotePath })
      return { ok: false, error: msg }
    }
  }

  async removeFiles(
    remotePath: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      this.log.info('drive removeFiles', { remotePath })
      await this.execCli(['filesystem', 'rm', remotePath])
      return { ok: true }
    } catch (err) {
      const msg = (err as Error).message
      this.log.error('drive remove failed', { error: msg, remotePath })
      return { ok: false, error: msg }
    }
  }

  private normalizeListOutput(parsed: unknown): DriveListEntry[] {
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (e): e is DriveListEntry => e !== null && typeof e === 'object',
      )
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      for (const key of ['files', 'entries', 'items'] as const) {
        const arr = obj[key]
        if (Array.isArray(arr)) {
          return arr.filter(
            (e): e is DriveListEntry => e !== null && typeof e === 'object',
          )
        }
      }
    }
    return []
  }
}
