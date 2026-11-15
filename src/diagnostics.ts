/**
 * Diagnóstico de conectividad con Proton Mail Bridge.
 *
 * Verifica cuatro capas en orden:
 *  1. TCP — ¿el puerto acepta conexiones?
 *  2. IMAP handshake — ¿responde el servidor y anuncia capacidades?
 *  3. Auth — ¿login exitoso?
 *  4. Folders — ¿las carpetas son accesibles?
 *
 * Fail-fast parcial: si un paso falla, los siguientes no se ejecutan
 * (la info de pasos fallidos es suficiente para diagnosticar).
 */
import { execFile, execFileSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { ImapFlow } from 'imapflow'
import type { BridgeConfig } from './config.js'
import { DIAG_EXEC_TIMEOUT_MS, DIAG_TCP_TIMEOUT_MS } from './constants.js'

export interface TcpDiagnostics {
  reachable: boolean
  latencyMs: number
  error?: string
}

export interface ImapHandshakeDiagnostics {
  ok: boolean
  capabilities: string[]
  greeting: string
  error?: string
}

export interface AuthDiagnostics {
  ok: boolean
  error?: string
}

export interface FoldersDiagnostics {
  count: number
  accessible: boolean
  error?: string
}

export interface MailDiagnostics {
  tcp: TcpDiagnostics
  imapHandshake?: ImapHandshakeDiagnostics
  auth?: AuthDiagnostics
  folders?: FoldersDiagnostics
}

function measureTcp(
  host: string,
  port: number,
  timeoutMs = DIAG_TCP_TIMEOUT_MS,
): Promise<TcpDiagnostics> {
  return new Promise((resolve) => {
    const started = Date.now()
    const sock = createConnection({ host, port, timeout: timeoutMs })
    sock.on('connect', () => {
      const latency = Date.now() - started
      sock.destroy()
      resolve({ reachable: true, latencyMs: latency })
    })
    sock.on('error', (err) => {
      sock.destroy()
      resolve({
        reachable: false,
        latencyMs: Date.now() - started,
        error: err.message,
      })
    })
    sock.on('timeout', () => {
      sock.destroy()
      resolve({
        reachable: false,
        latencyMs: Date.now() - started,
        error: `timeout after ${timeoutMs}ms`,
      })
    })
  })
}

async function checkImapHandshake(
  host: string,
  port: number,
  tlsInsecure: boolean,
): Promise<ImapHandshakeDiagnostics> {
  try {
    const c = new ImapFlow({
      host,
      port,
      secure: false,
      tls: { rejectUnauthorized: !tlsInsecure },
      logger: false,
    })
    c.on('error', () => {
      /* capturado por connect() */
    })
    await c.connect()
    const caps = c.capabilities as Map<string, unknown> | undefined
    const greeting = (c as { serverGreeting?: string }).serverGreeting ?? ''
    await c.logout().catch(() => {
      /* noop */
    })
    return {
      ok: true,
      capabilities: caps ? [...caps.keys()] : [],
      greeting,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, capabilities: [], greeting: '', error: msg }
  }
}

async function checkAuth(
  host: string,
  port: number,
  user: string,
  passwordResolver: () => Promise<string>,
  tlsInsecure: boolean,
): Promise<AuthDiagnostics> {
  let client: ImapFlow | null = null
  try {
    const pass = await passwordResolver()
    client = new ImapFlow({
      host,
      port,
      secure: false,
      tls: { rejectUnauthorized: !tlsInsecure },
      auth: { user, pass },
      logger: false,
    })
    client.on('error', () => {
      /* noop */
    })
    await client.connect()
    await client.logout().catch(() => {
      /* noop */
    })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (client)
      await client.logout().catch(() => {
        /* noop */
      })
    return { ok: false, error: msg }
  }
}

async function checkFolders(
  host: string,
  port: number,
  user: string,
  passwordResolver: () => Promise<string>,
  tlsInsecure: boolean,
): Promise<FoldersDiagnostics> {
  let client: ImapFlow | null = null
  try {
    const pass = await passwordResolver()
    client = new ImapFlow({
      host,
      port,
      secure: false,
      tls: { rejectUnauthorized: !tlsInsecure },
      auth: { user, pass },
      logger: false,
    })
    client.on('error', () => {
      /* noop */
    })
    await client.connect()
    const list = await client.list()
    await client.logout().catch(() => {
      /* noop */
    })
    return { count: list.length, accessible: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (client)
      await client.logout().catch(() => {
        /* noop */
      })
    return { count: 0, accessible: false, error: msg }
  }
}

export async function diagnoseMail(
  bridgeCfg: BridgeConfig,
  passwordResolver: () => Promise<string>,
): Promise<MailDiagnostics> {
  const tcp = await measureTcp(bridgeCfg.host, bridgeCfg.imapPort)

  if (!tcp.reachable) {
    return { tcp }
  }

  const imapHandshake = await checkImapHandshake(
    bridgeCfg.host,
    bridgeCfg.imapPort,
    bridgeCfg.tlsInsecure,
  )

  if (!imapHandshake.ok) {
    return { tcp, imapHandshake }
  }

  const auth = await checkAuth(
    bridgeCfg.host,
    bridgeCfg.imapPort,
    bridgeCfg.user,
    passwordResolver,
    bridgeCfg.tlsInsecure,
  )

  if (!auth.ok) {
    return { tcp, imapHandshake, auth }
  }

  const folders = await checkFolders(
    bridgeCfg.host,
    bridgeCfg.imapPort,
    bridgeCfg.user,
    passwordResolver,
    bridgeCfg.tlsInsecure,
  )

  return { tcp, imapHandshake, auth, folders }
}

// ---------------------------------------------------------------------------
// Drive diagnostics — CLI binary reachable + token persistente.
// ---------------------------------------------------------------------------

export interface CliDiagnostics {
  ok: boolean
  version?: string
  error?: string
}

export interface AuthStatusDiagnostics {
  ok: boolean
  error?: string
}

export interface DriveDiagnostics {
  cli: CliDiagnostics
  auth?: AuthStatusDiagnostics
}

export async function diagnoseDrive(cliBin: string): Promise<DriveDiagnostics> {
  const cli: CliDiagnostics = await new Promise((resolve) => {
    try {
      const version = execFileSync(cliBin, ['--version'], {
        encoding: 'utf-8',
        timeout: DIAG_EXEC_TIMEOUT_MS,
      }).trim()
      resolve({ ok: true, version })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      resolve({ ok: false, error: `proton-drive CLI not found: ${msg}` })
    }
  })

  if (!cli.ok) {
    return { cli }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(cliBin, ['auth', 'status'], { timeout: 15_000 }, (err) => {
        if (err) reject(new Error(err.message))
        else resolve()
      })
    })
    return { cli, auth: { ok: true } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { cli, auth: { ok: false, error: msg } }
  }
}
