 
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BridgeClient } from '../../src/bridge/bridge-client.js'

const BIN = '/usr/bin/protonmail-bridge-core'

let execFileImpl: ((...args: unknown[]) => unknown) | null = null
let existsSyncImpl: ((p: string) => boolean) | null = null
let portListeners = new Map<number, boolean>()
let processKillImpl: ((pid: number, signal?: number) => boolean) | null = null

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    if (execFileImpl) return execFileImpl(...args)
    return makeDefaultChild()
  },
}))

vi.mock('node:fs', () => ({
  existsSync: (p: string) => {
    if (existsSyncImpl) return existsSyncImpl(p)
    return p === BIN
  },
}))

vi.mock('node:net', () => {
  return {
    Socket: class MockSocket extends EventEmitter {
      connect(_port: number, _host: string) {
        const listening = portListeners.get(_port) ?? false
        if (listening) {
          setTimeout(() => {
            this.emit('connect')
            if (_port === 1143) {
              this.emit('data', Buffer.from('* OK Server ready\r\n'))
            }
          }, 5)
        } else {
          setTimeout(() => this.emit('error', new Error('ECONNREFUSED')), 5)
        }
        return this
      }
      setTimeout(_ms: number) {
        return this
      }
      destroy() {
        return this
      }
    },
  }
})

const originalProcessKill = process.kill.bind(process)

function makeDefaultChild() {
  const child = new EventEmitter() as any
  child.pid = 12345
  child.killed = false
  child.stdin = { write: vi.fn() }
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

function makeChildWithOutput(data: string, closeCode = 0) {
  const child = makeDefaultChild()
  const stdout = child.stdout as EventEmitter
  setTimeout(() => {
    stdout.emit('data', data)
    child.emit('close', closeCode)
  }, 0)
  return child
}

function makeChildThatStaysOpen() {
  const child = makeDefaultChild()
  const stdout = child.stdout as EventEmitter
  setTimeout(() => {
    stdout.emit('data', '>>> ')
  }, 0)
  const origWrite = child.stdin!.write as ReturnType<typeof vi.fn>
  child.stdin!.write = vi.fn((data: string) => {
    origWrite(data)
    if (typeof data === 'string' && data.includes('exit')) {
      setTimeout(() => child.emit('close', 0), 0)
    }
    return true
  })
  return child
}

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

beforeEach(() => {
  execFileImpl = null
  existsSyncImpl = null
  portListeners = new Map()
  process.kill = ((pid: number, signal?: number) => {
    if (processKillImpl) return processKillImpl(pid, signal)
    return originalProcessKill(pid, signal as unknown as NodeJS.Signals)
  }) as typeof process.kill
})
afterEach(() => {
  process.kill = originalProcessKill
})

describe('S01 — health: Bridge corriendo y autenticado', () => {
  it('devuelve ok:true con todos los checks verdes', async () => {
    portListeners.set(1143, true)
    portListeners.set(1025, true)
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    const h = await client.health()

    expect(h.ok).toBe(true)
    expect(h.processRunning).toBe(true)
    expect(h.imapListening).toBe(true)
    expect(h.smtpListening).toBe(true)
    expect(h.authOk).toBe(true)
    expect(h.error).toBeUndefined()
  })
})

describe('S02 — health: Bridge no instalado', () => {
  it('devuelve ok:false con error not found', async () => {
    existsSyncImpl = () => false

    const client = new BridgeClient('/nonexistent/bridge', silentLog)
    const h = await client.health()

    expect(h.ok).toBe(false)
    expect(h.processRunning).toBe(false)
    expect(h.error).toBe('not found')
  })
})

describe('S03 — health: Bridge instalado pero no corriendo', () => {
  it('devuelve ok:false con error process not running', async () => {
    const client = new BridgeClient(BIN, silentLog)
    const h = await client.health()

    expect(h.ok).toBe(false)
    expect(h.processRunning).toBe(false)
    expect(h.error).toBe('process not running')
  })
})

describe('S04 — health: Bridge corriendo pero no autenticado', () => {
  it('devuelve ok:false con authOk:false cuando puertos no escuchan', async () => {
    portListeners.set(1143, false)
    portListeners.set(1025, false)
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    const h = await client.health()

    expect(h.ok).toBe(false)
    expect(h.processRunning).toBe(true)
    expect(h.imapListening).toBe(false)
    expect(h.authOk).toBe(false)
  })
})

describe('S05 — info: sesión activa', () => {
  it('parsea user, version y puertos, y NO propaga la contraseña (F04)', async () => {
    const infoOutput = [
      'User: user@proton.me',
      'Bridge version: 3.15.0',
      'Password: abc123def456',
      'IMAP port: 1143',
      'SMTP port: 1025',
    ].join('\n')

    execFileImpl = () => makeChildWithOutput(infoOutput + '\n')

    const client = new BridgeClient(BIN, silentLog)
    const info = await client.info()

    expect(info.user).toBe('user@proton.me')
    expect(info.version).toBe('3.15.0')
    expect(info.imapPort).toBe(1143)
    expect(info.smtpPort).toBe(1025)
    // `bridge info` imprime la contraseña del Bridge; el DTO público no puede
    // contenerla porque se serializa hacia el modelo.
    expect(JSON.stringify(info)).not.toContain('abc123def456')
    expect(Object.keys(info)).not.toContain('bridgePassword')
  })
})

describe('S06 — info: sin sesión (no login)', () => {
  it('devuelve campos undefined cuando no hay output de login', async () => {
    execFileImpl = () => makeChildWithOutput('No accounts configured\n')

    const client = new BridgeClient(BIN, silentLog)
    const info = await client.info()

    expect(info.user).toBeUndefined()
    expect(info.version).toBeUndefined()
  })
})

describe('S07 — status: agrega health + info', () => {
  it('combina campos de info y health en un solo objeto', async () => {
    portListeners.set(1143, true)
    portListeners.set(1025, true)
    processKillImpl = () => true

    let callCount = 0
    execFileImpl = () => {
      callCount++
      if (callCount === 1) {
        return makeChildThatStaysOpen()
      }
      return makeChildWithOutput(
        'User: user@proton.me\nBridge version: 3.15.0\n',
      )
    }

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    const st = await client.status()

    expect(st.user).toBe('user@proton.me')
    expect(st.version).toBe('3.15.0')
    expect(st.processRunning).toBe(true)
    expect(st.imapListening).toBe(true)
    expect(st.smtpListening).toBe(true)
    expect(st.authOk).toBe(true)
  })
})

describe('S08 — login: credenciales correctas', () => {
  it('devuelve ok:true tras login exitoso', async () => {
    execFileImpl = () => makeChildWithOutput('logged in successfully\n')

    const client = new BridgeClient(BIN, silentLog)
    const result = await client.login('user@proton.me', 'secret-pass')

    expect(result.ok).toBe(true)
    expect(result.message).toBe('logged in')
  })
})

describe('S09 — login: 2FA requerido', () => {
  it('devuelve needs2FA:true cuando Bridge pide TOTP', async () => {
    execFileImpl = () => makeChildWithOutput('2FA code required\n')

    const client = new BridgeClient(BIN, silentLog)
    const result = await client.login('user@proton.me', 'secret-pass')

    expect(result.ok).toBe(false)
    expect(result.needs2FA).toBe(true)
  })
})

describe('S10 — login: 2FA + TOTP', () => {
  it('devuelve ok:true con TOTP proporcionado', async () => {
    execFileImpl = () => makeChildWithOutput('logged in successfully\n')

    const client = new BridgeClient(BIN, silentLog)
    const result = await client.login('user@proton.me', 'secret-pass', '123456')

    expect(result.ok).toBe(true)
    expect(result.needs2FA).toBeUndefined()
  })
})

describe('S11 — login: credenciales incorrectas', () => {
  it('devuelve ok:false con authentication failed', async () => {
    execFileImpl = () => makeChildWithOutput('authentication failed\n')

    const client = new BridgeClient(BIN, silentLog)
    const result = await client.login('user@proton.me', 'wrong-pass')

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/authentication failed/i)
  })
})

describe('S12 — logout: sesión activa', () => {
  it('devuelve ok:true tras logout exitoso', async () => {
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()

    execFileImpl = () => makeChildWithOutput('Logged out\n')
    const result = await client.logout()

    expect(result.ok).toBe(true)
  })
})

describe('S13 — logout: Bridge no corriendo', () => {
  it('devuelve ok:false cuando el proceso no existe', async () => {
    const client = new BridgeClient(BIN, silentLog)
    const result = await client.logout()

    expect(result.ok).toBe(false)
  })
})

describe('S14 — listAccounts: 2 cuentas', () => {
  it('parsea correctamente las cuentas del output list', async () => {
    const listOutput = [
      'user1@proton.me connected',
      'user2@proton.me connected',
    ].join('\n')

    execFileImpl = () => makeChildWithOutput(listOutput + '\n')

    const client = new BridgeClient(BIN, silentLog)
    const accounts = await client.listAccounts()

    expect(accounts).toHaveLength(2)
    expect(accounts[0]!.user).toBe('user1@proton.me')
    expect(accounts[0]!.state).toBe('connected')
    expect(accounts[1]!.user).toBe('user2@proton.me')
    expect(accounts[1]!.state).toBe('connected')
  })
})

describe('S15 — spawn: arranca Bridge', () => {
  it('resuelve cuando detecta el prompt >>>', async () => {
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()

    expect(client.isRunning()).toBe(true)
  })
})

describe('S16 — shutdown: cierra graceful', () => {
  it('envía exit y SIGTERM, proceso muere', async () => {
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    expect(client.isRunning()).toBe(true)

    await client.shutdown()
  })
})

describe('S17 — CLI timeout: Bridge no responde', () => {
  it('rechaza con timeout cuando no hay >>> en 30s', async () => {
    execFileImpl = () => makeDefaultChild()

    vi.useFakeTimers({ shouldAdvanceTime: true })

    const client = new BridgeClient(BIN, silentLog)
    const promise = client.health()

    vi.advanceTimersByTime(31_000)

    const h = await promise
    expect(h.ok).toBe(false)
    expect(h.error).toBeDefined()

    vi.useRealTimers()
  })
})

describe('S17b — cliCommand timeout', () => {
  it('devuelve {} cuando CLI timeout (info captura error)', async () => {
    execFileImpl = () => makeDefaultChild()

    vi.useFakeTimers({ shouldAdvanceTime: true })

    const client = new BridgeClient(BIN, silentLog)
    const promise = client.info()

    vi.advanceTimersByTime(31_000)

    const result = await promise
    expect(result).toEqual({})

    vi.useRealTimers()
  })
})

describe('isRunning', () => {
  it('devuelve false sin proceso spawneado', () => {
    const client = new BridgeClient(BIN, silentLog)
    expect(client.isRunning()).toBe(false)
  })
})

// ===========================================================================
// Gaps de cobertura — Ronda 4
// ===========================================================================

describe('R4 — login con bin not found', () => {
  it('devuelve ok:false message not found', async () => {
    existsSyncImpl = () => false
    const client = new BridgeClient('/missing', silentLog)
    const result = await client.login('u@t.com', 'pwd')
    expect(result.ok).toBe(false)
    expect(result.message).toBe('not found')
  })
})

describe('R4 — login: catch de CLI error', () => {
  it('devuelve ok:false con mensaje del error', async () => {
    execFileImpl = () => {
      const child = makeDefaultChild()
      setTimeout(() => child.emit('error', new Error('ENOENT')), 0)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    const result = await client.login('u@t.com', 'pwd')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/ENOENT/i)
  })
})

describe('R4 — info: bin not found', () => {
  it('devuelve {} cuando bin no existe', async () => {
    existsSyncImpl = () => false
    const client = new BridgeClient('/missing', silentLog)
    const result = await client.info()
    expect(result).toEqual({})
  })
})

describe('R4 — listAccounts: bin not found', () => {
  it('devuelve [] vacío cuando bin no existe', async () => {
    existsSyncImpl = () => false
    const client = new BridgeClient('/missing', silentLog)
    const accounts = await client.listAccounts()
    expect(accounts).toEqual([])
  })
})

describe('R4 — listAccounts: CLI error catch', () => {
  it('devuelve [] vacío cuando CLI lanza', async () => {
    execFileImpl = () => {
      const child = makeDefaultChild()
      setTimeout(() => child.emit('close', 1), 0)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    const accounts = await client.listAccounts()
    expect(accounts).toEqual([])
  })
})

describe('R4 — listAccounts: salida vacía / líneas sin formato cuenta', () => {
  it('ignora líneas que no coinciden con el patrón email+state', async () => {
    execFileImpl = () => makeChildWithOutput(
      'Not a valid line\nNo accounts\n',
    )
    const client = new BridgeClient(BIN, silentLog)
    const accounts = await client.listAccounts()
    expect(accounts).toEqual([])
  })
})

describe('R4 — logout: bin not found', () => {
  it('devuelve ok:false cuando bridge bin no existe', async () => {
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()
    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()

    existsSyncImpl = () => false
    const result = await client.logout()
    expect(result.ok).toBe(false)
  })
})

describe('R4 — logout: catch de CLI error', () => {
  it('devuelve ok:false cuando CLI command lanza', async () => {
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()
    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()

    execFileImpl = () => {
      const child = makeDefaultChild()
      setTimeout(() => child.emit('error', new Error('EPERM')), 0)
      return child
    }
    const result = await client.logout()
    expect(result.ok).toBe(false)
  })
})

describe('R4 — spawn: bin not found', () => {
  it('lanza error not found cuando bin no existe', async () => {
    const client = new BridgeClient('/missing', silentLog)
    await expect(client.spawn()).rejects.toThrow('not found')
  })
})

describe('R4 — spawn: ya spawneado (no-op)', () => {
  it('no lanza si ya está spawneado', async () => {
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    await client.spawn() // segunda llamada es no-op

    expect(client.isRunning()).toBe(true)
  })
})

describe('R4 — spawn: child error', () => {
  it('rechaza cuando child emite error', async () => {
    execFileImpl = () => {
      const child = makeDefaultChild()
      setTimeout(() => child.emit('error', new Error('EACCES')), 0)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    await expect(client.spawn()).rejects.toThrow('EACCES')
  })
})

describe('R4 — spawn: close antes de prompt', () => {
  it('rechaza con mensaje de código de salida', async () => {
    execFileImpl = () => {
      const child = makeDefaultChild()
      setTimeout(() => child.emit('close', 1), 0)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    await expect(client.spawn()).rejects.toThrow(/bridge exited with 1/)
  })
})

describe('R4 — shutdown: sin spawn (no-op)', () => {
  it('no lanza cuando no hay child', async () => {
    const client = new BridgeClient(BIN, silentLog)
    await expect(client.shutdown()).resolves.toBeUndefined()
  })
})

describe('R4 — shutdown: SIGTERM fallback cuando close no llega', () => {
  it('mata con SIGTERM tras timeout de 5s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()

    // No hay close event — shutdown debe caer en timeout y matar con SIGTERM
    const promise = client.shutdown()
    vi.advanceTimersByTime(6_000)
    await promise

    vi.useRealTimers()
  })
})

describe('R4 — cliCommand: close con código no-cero sin output', () => {
  it('rechaza cuando close code !=0 y output vacío', async () => {
    execFileImpl = () => {
      const child = makeDefaultChild()
      setTimeout(() => {
        child.emit('close', 1)
      }, 0)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    // info capturará el error y devolverá {}
    const result = await client.info()
    expect(result).toEqual({})
  })
})

describe('R4 — checkProcessRunning con kill error', () => {
  it('devuelve false cuando process.kill lanza', async () => {
    processKillImpl = () => { throw new Error('ESRCH') }
    execFileImpl = () => {
      const child = makeDefaultChild()
      setTimeout(() => child.stdout!.emit('data', '>>> '), 0)
      return child
    }

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    expect(client.isRunning()).toBe(false)
  })
})

describe('R4 — checkImapAuth: connect error', () => {
  it('devuelve false cuando socket falla en connect', async () => {
    // Sin listener en puerto 1143 = error al conectar
    portListeners.set(1143, false)
    portListeners.set(1025, true)
    processKillImpl = () => true
    execFileImpl = () => makeChildThatStaysOpen()

    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    const h = await client.health()

    expect(h.authOk).toBe(false)
    expect(h.imapListening).toBe(false)
  })
})



describe('R4 — info: regex parcial (solo algunos campos)', () => {
  it('parsea solo user cuando otros campos faltan', async () => {
    execFileImpl = () => makeChildWithOutput('User: u@proton.me\n')
    const client = new BridgeClient(BIN, silentLog)
    const info = await client.info()
    expect(info.user).toBe('u@proton.me')
    expect(info.version).toBeUndefined()
    expect(Object.keys(info)).not.toContain('bridgePassword')
    expect(info.imapPort).toBeUndefined()
    expect(info.smtpPort).toBeUndefined()
  })
})

describe('R5 — login: cliInteractive prompt Username handler', () => {
  it('envía user cuando recibe prompt Username', async () => {
    execFileImpl = () => {
      const child = makeDefaultChild()
      const stdout = child.stdout as EventEmitter
      setTimeout(() => stdout.emit('data', '>>> '), 0)
      setTimeout(() => stdout.emit('data', 'Username: '), 10)
      setTimeout(() => stdout.emit('data', 'Password: '), 20)
      setTimeout(() => stdout.emit('data', 'logged in successfully\n'), 30)
      setTimeout(() => child.emit('close', 0), 40)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    const result = await client.login('u@test.com', 'secret')
    expect(result.ok).toBe(true)
  })
})

describe('R5 — login: cliInteractive prompt 2FA handler with TOTP', () => {
  it('envía TOTP cuando recibe prompt TOTP', async () => {
    execFileImpl = () => {
      const child = makeDefaultChild()
      const stdout = child.stdout as EventEmitter
      setTimeout(() => stdout.emit('data', '>>> '), 0)
      setTimeout(() => stdout.emit('data', 'Username: '), 10)
      setTimeout(() => stdout.emit('data', 'Password: '), 20)
      setTimeout(() => stdout.emit('data', 'TOTP: '), 30)
      setTimeout(() => stdout.emit('data', '2FA code required'), 40)
      setTimeout(() => child.emit('close', 0), 50)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    const result = await client.login('u@test.com', 'secret', '123456')
    expect(result.ok).toBe(false)
    expect(result.needs2FA).toBe(true)
  })
})

describe('R5 — shutdown: stdin.write error catch', () => {
  it('no lanza cuando stdin.write falla', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    processKillImpl = () => true
    execFileImpl = () => {
      const child = makeChildThatStaysOpen()
      child.stdin!.write = vi.fn(() => { throw new Error('EPIPE') })
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    await client.spawn()
    const promise = client.shutdown()
    vi.advanceTimersByTime(6_000)
    await expect(promise).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})

describe('R6 — login: unknown prompt idle timeout', () => {
  it('rejects with unknown bridge prompt when stdout never matches known markers', async () => {
    vi.useFakeTimers()
    execFileImpl = () => {
      const child = makeDefaultChild()
      const stdout = child.stdout as EventEmitter
      setTimeout(() => stdout.emit('data', 'UNEXPECTED PROMPT PLEASE TYPE MAGIC\n'), 0)
      return child
    }
    const client = new BridgeClient(BIN, silentLog)
    const loginPromise = client.login('u@test.com', 'secret')
    const assertion = expect(loginPromise).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/unknown bridge prompt/),
    })
    await vi.advanceTimersByTimeAsync(16_000)
    await assertion
    vi.useRealTimers()
  })
})
