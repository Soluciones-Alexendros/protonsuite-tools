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
