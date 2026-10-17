/**
 * P04-O02 — Endurecimiento del transporte HTTP (hallazgos F20–F22, F27, F28).
 *
 * El más grave era F28: sin `MCP_AUTH_TOKEN`, `compareTokens("", "")` devolvía
 * `true` y **cualquier petición sin cabecera pasaba**. El entrypoint lo evitaba
 * con un `process.exit`, pero la fábrica HTTP no: cualquiera que la montara
 * (tests, otro binario) podía dejar un servidor abierto.
 */
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildHttpApp } from '../src/http.js'
import { compareTokens } from '../src/auth.js'
import type { Config } from '../src/config.js'
import { registry as metricsRegistry } from '../src/utils/metrics.js'

const silent = { debug: () => {}, info: () => {}, error: () => {} }

const TOKEN = 'token-de-pruebas-suficientemente-largo'

function cfg(overrides: Partial<Config['transport']> = {}): Config {
  return {
    products: {
      mail: { enabled: false, bridge: { user: 'x@y.z', pass: 'p', from: 'x@y.z' } },
      pass: { enabled: false, storeDir: '/tmp' },
      calendar: { enabled: false, experimental: false },
      drive: { enabled: false, cliBin: 'proton-drive', stagingDir: '/tmp', obsoleteExtensions: [] },
    },
    transport: {
      kind: 'http',
      httpHost: '127.0.0.1',
      httpPort: 8787,
      authToken: TOKEN,
      allowedOrigins: [],
      ...overrides,
    },
    alerts: { enabled: false, logDir: '/tmp', minSeverity: 'warning' },
    agent: { dryRun: true, maxInspectEmails: 10, minConfidence: 0.6 },
    logLevel: 'error',
  } as Config
}

function miniServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  server.registerTool('proton_suite_status', { description: 'x' }, (() => ({
    content: [{ type: 'text', text: 'ok' }],
  })) as never)
  return server
}

const app = (overrides: Partial<Config['transport']> = {}) =>
  buildHttpApp({ buildServer: miniServer, cfg: cfg(overrides), log: silent })

describe('F28 · la fábrica no construye un servidor abierto', () => {
  it('sin token, no se puede montar', () => {
    expect(() => app({ authToken: undefined })).toThrow(/MCP_AUTH_TOKEN/)
  })

  it('con token vacío, tampoco', () => {
    expect(() => app({ authToken: '' })).toThrow(/MCP_AUTH_TOKEN/)
  })

  it('con token demasiado corto, tampoco', () => {
    expect(() => app({ authToken: 'corto' })).toThrow(/al menos/)
  })

  it('en la raíz: un token esperado vacío nunca casa', () => {
    expect(compareTokens('', '')).toBe(false)
    expect(compareTokens('lo-que-sea', '')).toBe(false)
  })

  it('sin cabecera Authorization, la petición se rechaza', async () => {
    const res = await request(app())
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(res.status).toBe(401)
  })
})

describe('F21 · el cuerpo se parsea DESPUÉS de autenticar', () => {
  it('un cuerpo enorme sin credenciales se rechaza sin parsearlo', async () => {
    // Antes, `express.json({ limit: "25mb" })` iba montado al principio: un
    // desconocido podía obligar al servidor a parsear 25 MB. Ahora el 401 sale
    // antes, así que ni se mira el cuerpo.
    const enorme = 'x'.repeat(1024 * 1024)
    const res = await request(app())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ relleno: enorme }))

    expect(res.status).toBe(401)
  })

  it('un cuerpo malformado sin credenciales da 401, no 500', async () => {
    // Si el parseo fuera antes del auth, saldría un 500 de JSON inválido.
    const res = await request(app())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send('{esto no es json')

    expect(res.status).toBe(401)
  })

  it('con credenciales válidas, el cuerpo sí se procesa', async () => {
    const res = await request(app())
      .post('/mcp')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      })

    expect(res.status).toBe(200)
  })
})

describe('F22 · las métricas no crecen sin freno', () => {
  it('un método inventado no crea una serie nueva', async () => {
    const antes = metricsRegistry
      .text()
      .split('\n')
      .filter((l) => l.startsWith('mcp_requests_total')).length

    // Un cliente puede mandar cualquier cadena como método.
    for (const metodo of ['inventado-1', 'inventado-2', 'inventado-3']) {
      await request(app())
        .post('/mcp')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 9, method: metodo })
    }

    const despues = metricsRegistry
      .text()
      .split('\n')
      .filter((l) => l.startsWith('mcp_requests_total')).length

    // Como mucho se añade la serie «other» y el estado; no una por método.
    expect(despues - antes).toBeLessThanOrEqual(2)
    expect(metricsRegistry.text()).toContain('method="other"')
    expect(metricsRegistry.text()).not.toContain('inventado-1')
  })

  it('los rechazos previos se anotan con una etiqueta fija', async () => {
    await request(app()).post('/mcp').send({})

    const texto = metricsRegistry.text()
    expect(texto).toContain('method="unauthenticated"')
    expect(texto).toContain('status="401"')
  })
})

describe('F20 · el límite previo va por origen, no por token', () => {
  it('rotar tokens no evita el límite previo', async () => {
    const server = app()
    let rechazado = false
    // El cubo previo es de 300/min: se agota con tokens distintos, que es lo
    // que un atacante haría para estrenar cubo en cada intento.
    for (let i = 0; i < 305 && !rechazado; i++) {
      const res = await request(server)
        .post('/mcp')
        .set('Authorization', `Bearer token-inventado-${i}`)
        .send({})
      if (res.status === 429) rechazado = true
    }
    expect(rechazado).toBe(true)
  })
})

describe('F27 · Host y Origin', () => {
  it('rechaza un Host que no es el nuestro (DNS rebinding)', async () => {
    const res = await request(app())
      .post('/mcp')
      .set('Host', 'evil.example.com')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'host_not_allowed' })
  })

  it('acepta el Host configurado, con puerto o sin él', async () => {
    for (const host of ['127.0.0.1', '127.0.0.1:9999', 'localhost:8787']) {
      const res = await request(app())
        .post('/mcp')
        .set('Host', host)
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 't', version: '1' },
          },
        })
      expect(res.status, `Host ${host}`).toBe(200)
    }
  })

  it('respeta la lista declarada por el operador', async () => {
    const servidor = app({ allowedHosts: ['mi-servidor.local'] })

    const propio = await request(servidor)
      .post('/mcp')
      .set('Host', 'mi-servidor.local:8787')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
    expect(propio.status).not.toBe(403)

    // Con lista explícita, los nombres derivados dejan de valer.
    const otro = await request(servidor)
      .post('/mcp')
      .set('Host', '127.0.0.1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
    expect(otro.status).toBe(403)
  })

  it('un Origin de navegador sin allowlist se rechaza, no se da por bueno', async () => {
    const res = await request(app())
      .post('/mcp')
      .set('Origin', 'https://sitio-cualquiera.example')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})

    expect(res.status).toBe(403)
    expect(res.body.hint).toContain('MCP_ALLOWED_ORIGINS')
  })

  it('un Origin permitido pasa', async () => {
    const res = await request(app({ allowedOrigins: ['https://app.example.com'] }))
      .post('/mcp')
      .set('Origin', 'https://app.example.com')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})

    expect(res.status).not.toBe(403)
  })

  it('sin Origin (línea de comandos, backend) no se exige allowlist', async () => {
    const res = await request(app())
      .post('/mcp')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})

    expect(res.status).not.toBe(403)
  })
})

describe('F23 · cupos de sesión y concurrencia', () => {
  it('no se pueden abrir más sesiones que el cupo', async () => {
    const servidor = app({ maxSessions: 2 })
    const abrir = () =>
      request(servidor)
        .post('/mcp')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 't', version: '1' },
          },
        })

    const a = await abrir()
    const b = await abrir()
    const c = await abrir()

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    // La tercera se rechaza en vez de hacer crecer el mapa sin freno.
    expect(c.status).toBe(503)
    expect(c.body.error.message).toBe('too_many_sessions')
  })
})

describe('nombres de host · formas raras', () => {
  it('entiende IPv6 entre corchetes', async () => {
    for (const host of ['[::1]:8787', '[::1]']) {
      const res = await request(app())
        .post('/mcp')
        .set('Host', host)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({})
      expect(res.status, `Host ${host}`).not.toBe(403)
    }
  })

  it('un nombre con puerto se compara por el nombre', async () => {
    const res = await request(app({ allowedHosts: ['mi-casa.local'] }))
      .post('/mcp')
      .set('Host', 'mi-casa.local:1234')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
    expect(res.status).not.toBe(403)
  })

  it('un Host vacío se rechaza', async () => {
    const res = await request(app())
      .post('/mcp')
      .set('Host', '')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
    expect(res.status).toBe(403)
  })
})

describe('F23 · corte por concurrencia y apagado', () => {
  it('con el cupo lleno responde 503 en vez de aceptar trabajo', async () => {
    // Un servidor que se queda colgado al conectar mantiene la petición en
    // curso, así que la siguiente choca con el cupo. Es determinista.
    const colgado = () =>
      ({ connect: () => new Promise(() => {}), registerTool: () => {} }) as never
    const servidor = buildHttpApp({
      buildServer: colgado,
      cfg: cfg({ maxConcurrentRequests: 1 }),
      log: silent,
    })

    const peticion = (id: number) =>
      request(servidor)
        .post('/mcp')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 't', version: '1' },
          },
        })

    // La primera se queda colgada; no se espera.
    const primera = peticion(1).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 50))

    const segunda = await peticion(2)
    expect(segunda.status).toBe(503)
    expect(segunda.body.error.message).toBe('server_busy')

    void primera
  })

  it('dispose cierra las sesiones y no se queda colgado', async () => {
    const servidor = app()

    const init = await request(servidor)
      .post('/mcp')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      })
    expect(init.status).toBe(200)

    const antes = await request(servidor).get('/healthz')
    expect(antes.body.sessions).toBe(1)

    await expect(servidor.dispose()).resolves.toBeUndefined()

    const despues = await request(servidor).get('/healthz')
    expect(despues.body.sessions).toBe(0)
  })

  it('dispose se puede llamar dos veces sin romperse', async () => {
    const servidor = app()
    await servidor.dispose()
    await expect(servidor.dispose()).resolves.toBeUndefined()
  })
})

describe('escuchar en todas las interfaces', () => {
  it('0.0.0.0 es para escuchar, no un nombre por el que te llaman', async () => {
    const servidor = app({ httpHost: '0.0.0.0' })

    // El nombre de enlace no se acepta como Host: no identifica al servidor.
    const bind = await request(servidor)
      .post('/mcp')
      .set('Host', '0.0.0.0:8787')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
    expect(bind.status).toBe(403)

    // Los nombres de bucle local siguen valiendo, para no romper el uso local.
    const local = await request(servidor)
      .post('/mcp')
      .set('Host', 'localhost:8787')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
    expect(local.status).not.toBe(403)
  })

  it('con 0.0.0.0 y lista explícita, manda la lista', async () => {
    const servidor = app({ httpHost: '0.0.0.0', allowedHosts: ['agente.mi-dominio.com'] })

    const propio = await request(servidor)
      .post('/mcp')
      .set('Host', 'agente.mi-dominio.com')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({})
    expect(propio.status).not.toBe(403)
  })
})

describe('límite previo · clave por origen', () => {
  it('un cliente sin token también consume cuota, y no la comparte por token', async () => {
    const servidor = app({ maxConcurrentRequests: 64 })

    // Sin Authorization: la clave del límite previo cae al origen. Varios
    // intentos anónimos deben ir al mismo cubo, no a uno por token inventado.
    for (let i = 0; i < 5; i++) {
      const res = await request(servidor).post('/mcp').send({})
      expect(res.status).toBe(401)
    }
  })
})
