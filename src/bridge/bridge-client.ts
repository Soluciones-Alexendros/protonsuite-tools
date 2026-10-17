import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as net from 'node:net'
import type { SecretLogger } from '../security.js'

export interface BridgeConfig {
  bin: string
  imapPort: number
  smtpPort: number
  host: string
}

/**
 * DTO PÚBLICO de Bridge.
 *
 * NO añadir credenciales aquí: `bridge info` imprime la contraseña del Bridge
 * en su salida, pero este objeto llega a `structuredContent` y al modelo.
 * Extraerla fue el hallazgo F04 (fuga del secreto al estado JSON).
 */
export interface BridgeInfo {
  [key: string]: unknown
  user?: string
  version?: string
  smtpPort?: number
  imapPort?: number
}

export interface BridgeHealth {
  [key: string]: unknown
  ok: boolean
  processRunning: boolean
  imapListening: boolean
  smtpListening: boolean
  authOk: boolean
  error?: string
}

export interface BridgeStatus extends BridgeInfo {
  [key: string]: unknown
  processRunning: boolean
  imapListening: boolean
  smtpListening: boolean
  authOk: boolean
}

export interface BridgeAccount {
  user: string
  state: 'connected' | 'disconnected' | 'connecting'
}

export interface LoginResult {
  [key: string]: unknown
  ok: boolean
  message: string
  needs2FA?: boolean
}

const CLI_TIMEOUT = 30_000
const SPAWN_PROMPT_TIMEOUT = 15_000
const PROMPT_IDLE_TIMEOUT = 15_000

const KNOWN_PROMPT_MARKERS = [
  '>>>',
  'Username',
  'email',
  'Password',
  '2FA',
  'TOTP',
  'two-factor',
  'logged in',
  'success',
  'OK',
] as const

function bufferMatchesKnownPrompt(buffer: string): boolean {
  return KNOWN_PROMPT_MARKERS.some((m) => buffer.includes(m))
}

function sanitizePromptSnippet(buffer: string, maxLen = 120): string {
  return buffer.replace(/[\r\n]+/g, ' ').slice(-maxLen)
}

export class BridgeClient {
  private child: ChildProcess | null = null

  constructor(
    private readonly bin: string,
    private readonly log: SecretLogger,
  ) {}

  async info(): Promise<BridgeInfo> {
    if (!existsSync(this.bin)) {
      this.log.debug('bridge info: bin not found', { bin: this.bin })
      return {}
    }
    try {
      const raw = await this.cliCommand('info')
      const user = /User:\s*(\S+@\S+)/.exec(raw)
      const version = /Bridge version:\s*(\S+)/.exec(raw)
      const imapPort = /IMAP port:\s*(\d+)/.exec(raw)
      const smtpPort = /SMTP port:\s*(\d+)/.exec(raw)
      // Deliberadamente NO se extrae `Password:` de la salida: es un secreto y
      // este DTO se serializa hacia el modelo (F04). Quien necesite la
      // contraseña debe obtenerla de su origen configurado, no de aquí.
      return {
        ...(user ? { user: user[1] } : {}),
        ...(version ? { version: version[1] } : {}),
        ...(imapPort ? { imapPort: Number(imapPort[1]) } : {}),
        ...(smtpPort ? { smtpPort: Number(smtpPort[1]) } : {}),
      }
    } catch (err) {
      this.log.warn('bridge info failed', {
        error: (err as Error).message,
      })
      return {}
    }
  }

  async health(): Promise<BridgeHealth> {
    if (!existsSync(this.bin)) {
      return {
        ok: false,
        processRunning: false,
        imapListening: false,
        smtpListening: false,
        authOk: false,
        error: 'not found',
      }
    }

    const processRunning = this.checkProcessRunning()
    if (!processRunning) {
      return {
        ok: false,
        processRunning: false,
        imapListening: false,
        smtpListening: false,
        authOk: false,
        error: 'process not running',
      }
    }

    const [imapListening, smtpListening] = await Promise.all([
      this.checkPort(1143),
      this.checkPort(1025),
    ])

    const authOk = imapListening ? await this.checkImapAuth() : false

    const ok = imapListening && authOk
    return {
      ok,
      processRunning,
      imapListening,
      smtpListening,
      authOk,
    }
  }

  async status(): Promise<BridgeStatus> {
    const [info, health] = await Promise.all([this.info(), this.health()])
    return {
      ...info,
      processRunning: health.processRunning,
      imapListening: health.imapListening,
      smtpListening: health.smtpListening,
      authOk: health.authOk,
    }
  }

  async login(
    user: string,
    password: string,
    totp?: string,
  ): Promise<LoginResult> {
    if (!existsSync(this.bin)) {
      return { ok: false, message: 'not found' }
    }
    try {
      const result = await this.cliInteractive('login', (send, onData) => {
        onData((data: string) => {
          if (data.includes('Username') || data.includes('email')) {
            send(user + '\n')
          } else if (data.includes('Password') && !data.includes('bridge')) {
            send(password + '\n')
          } else if (
            data.includes('2FA') ||
            data.includes('TOTP') ||
            data.includes('two-factor')
          ) {
            if (totp) {
              send(totp + '\n')
            }
          }
        })
      })
      if (
        result.includes('logged in') ||
        result.includes('success') ||
        result.includes('OK')
      ) {
        return { ok: true, message: 'logged in' }
      }
      if (
        result.includes('2FA') ||
        result.includes('two-factor') ||
        result.includes('TOTP')
      ) {
        return { ok: false, message: '2FA required', needs2FA: true }
      }
      return { ok: false, message: 'authentication failed' }
    } catch (err) {
      this.log.warn('bridge login failed', {
        error: (err as Error).message,
      })
      return { ok: false, message: (err as Error).message }
    }
  }

  async logout(): Promise<{ ok: boolean }> {
    if (!this.checkProcessRunning() || !existsSync(this.bin)) {
      return { ok: false }
    }
    try {
      await this.cliCommand('logout')
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  async listAccounts(): Promise<BridgeAccount[]> {
    if (!existsSync(this.bin)) {
      return []
    }
    try {
      const raw = await this.cliCommand('list')
      const accounts: BridgeAccount[] = []
      const lines = raw.split('\n')
      for (const line of lines) {
        const match = /(\S+@\S+)\s+(\w+)/.exec(line.trim())
        if (match?.[1] && match[2]) {
          accounts.push({ user: match[1], state: match[2].toLowerCase() as BridgeAccount['state'] })
        }
      }
      return accounts
    } catch (err) {
      this.log.warn('bridge listAccounts failed', {
        error: (err as Error).message,
      })
      return []
    }
  }

  async spawn(): Promise<void> {
    if (!existsSync(this.bin)) {
      throw new Error('not found')
    }
    if (this.child && !this.child.killed) return

    this.child = execFile(this.bin, ['--cli'], {
      timeout: SPAWN_PROMPT_TIMEOUT,
    })
    const child = this.child

    await new Promise<void>((resolve, reject) => {
      let out = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('spawn timeout'))
      }, SPAWN_PROMPT_TIMEOUT)

      child.stdout?.on('data', (d: string) => {
        out += d
        if (out.includes('>>>')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        if (!out.includes('>>>')) {
          clearTimeout(timer)
          reject(new Error(`bridge exited with ${code}`))
        }
      })
    })
  }

  async shutdown(): Promise<void> {
    if (!this.child || this.child.killed) return
    const child = this.child

    try {
      child.stdin?.write('exit\n')
    } catch {
      // process already dead
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        resolve()
      }, 5_000)
      child.on('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  isRunning(): boolean {
    return this.checkProcessRunning()
  }

  private checkProcessRunning(): boolean {
    if (this.child && !this.child.killed && this.child.pid) {
      try {
        process.kill(this.child.pid, 0)
        return true
      } catch {
        return false
      }
    }
    return false
  }

  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(2_000)
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.connect(port, '127.0.0.1')
    })
  }

  private checkImapAuth(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(3_000)
      socket.once('connect', () => {
        let buf = ''
        const onData = (chunk: Buffer) => {
          buf += chunk.toString()
          if (buf.includes('* OK') || buf.includes('* PREAUTH')) {
            socket.destroy()
            resolve(true)
          }
        }
        socket.on('data', onData)
        socket.once('error', () => {
          socket.removeListener('data', onData)
          resolve(false)
        })
        socket.once('timeout', () => {
          socket.removeListener('data', onData)
          socket.destroy()
          resolve(false)
        })
      })
      socket.once('error', () => {
        resolve(false)
      })
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.connect(1143, '127.0.0.1')
    })
  }

  private cliCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(this.bin, ['--cli'], { timeout: CLI_TIMEOUT })
      let out = ''

      child.stdout?.on('data', (d: string) => {
        out += d
        if (out.includes('>>>')) {
          child.stdin?.write(command + '\n')
        }
      })

      child.on('close', (code) => {
        if (code === 0 || out.length > 0) resolve(out)
        else reject(new Error(`bridge exited with ${code}`))
      })
      child.on('error', reject)

      setTimeout(() => {
        child.kill()
        reject(new Error('timeout after 30s'))
      }, CLI_TIMEOUT)
    })
  }

  private cliInteractive(
    command: string,
    configure: (
      send: (data: string) => void,
      onData: (handler: (data: string) => void) => void,
    ) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(this.bin, ['--cli'], { timeout: CLI_TIMEOUT })
      let out = ''
      let started = false
      let settled = false

      const send = (data: string) => {
        child.stdin?.write(data)
      }

      const handlers: ((data: string) => void)[] = []
      const onData = (handler: (data: string) => void) => {
        handlers.push(handler)
      }

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(globalTimer)
        clearTimeout(idleTimer)
        fn()
      }

      const resetIdleTimer = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          if (settled) return
          if (out.length > 0 && !bufferMatchesKnownPrompt(out)) {
            child.kill()
            finish(() => {
              reject(
                new Error(
                  `unknown bridge prompt (idle ${PROMPT_IDLE_TIMEOUT / 1000}s): ${sanitizePromptSnippet(out)}`,
                ),
              )
            })
          }
        }, PROMPT_IDLE_TIMEOUT)
      }

      configure(send, onData)

      let idleTimer = setTimeout(() => {
        /* replaced by resetIdleTimer on first data */
      }, PROMPT_IDLE_TIMEOUT)
      resetIdleTimer()

      child.stdout?.on('data', (d: string) => {
        out += d
        resetIdleTimer()
        if (out.includes('>>>') && !started) {
          started = true
          child.stdin?.write(command + '\n')
        } else if (started) {
          for (const h of handlers) h(d)
        }
      })

      child.on('close', (code) => {
        finish(() => {
          if (code === 0 || out.length > 0) resolve(out)
          else reject(new Error(`bridge exited with ${code}`))
        })
      })
      child.on('error', (err) => {
        finish(() => {
          reject(err)
        })
      })

      const globalTimer = setTimeout(() => {
        child.kill()
        finish(() => {
          reject(new Error('timeout after 30s'))
        })
      }, CLI_TIMEOUT)
    })
  }
}
