#!/usr/bin/env node
// T-SCOPE-01 — Registro EFECTIVO de capacidades MCP por perfil, medido en runtime.
// No cuenta nombres en el codigo fuente: arranca el servidor y lee tools/list.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const BASE_ENV = {
  PROTON_BRIDGE_USER: 'scope@proton.me',
  PROTON_BRIDGE_PASS: 'x',
  PROTON_MAIL_FROM: 'scope@proton.me',
  MCP_TRANSPORT: 'stdio',
  LOG_LEVEL: 'error',
}

const PROFILES = {
  'P-DEFAULT': {},
  'P-MAIL-OFF': { PROTON_MAIL_ENABLED: 'false' },
  'P-PASS-UNIX': {
    PROTON_MAIL_ENABLED: 'false',
    PROTON_PASS_ENABLED: 'true',
    PROTON_PASS_BACKEND: 'pass',
    DRIVE_ENABLED: 'false',
    PROTON_CALENDAR_ENABLED: 'false',
  },
  'P-DRIVE': {
    PROTON_MAIL_ENABLED: 'false',
    PROTON_PASS_ENABLED: 'false',
    DRIVE_ENABLED: 'true',
  },
  'P-CALENDAR-EXPERIMENTAL': {
    PROTON_CALENDAR_ENABLED: 'true',
    PROTON_CALENDAR_EXPERIMENTAL: 'true',
  },
  'P-ALL-PRODUCTS-OFF': {
    PROTON_MAIL_ENABLED: 'false',
    PROTON_PASS_ENABLED: 'false',
    DRIVE_ENABLED: 'false',
    PROTON_CALENDAR_ENABLED: 'false',
  },
}

function probe(env) {
  return new Promise((resolve) => {
    const child = spawn('node', ['dist/index.js'], {
      env: { ...process.env, ...BASE_ENV, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d.toString()
    })
    child.stderr.on('data', () => {})
    const send = (o) => child.stdin.write(JSON.stringify(o) + '\n')
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'scope-probe', version: '1' },
      },
    })
    setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/initialized' }), 150)
    setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), 300)
    setTimeout(() => send({ jsonrpc: '2.0', id: 3, method: 'resources/list' }), 420)
    setTimeout(() => send({ jsonrpc: '2.0', id: 4, method: 'prompts/list' }), 520)
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve(out)
    }, 1600)
  })
}

const parse = (raw) => {
  const msgs = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      msgs.push(JSON.parse(t))
    } catch {
      /* linea parcial */
    }
  }
  return msgs
}

const result = {}
for (const [name, env] of Object.entries(PROFILES)) {
  const msgs = parse(await probe(env))
  const init = msgs.find((m) => m.id === 1)
  const tools = msgs.find((m) => m.id === 2)
  const resources = msgs.find((m) => m.id === 3)
  const prompts = msgs.find((m) => m.id === 4)
  const names = (tools?.result?.tools ?? []).map((t) => t.name).sort()
  result[name] = {
    protocolVersion: init?.result?.protocolVersion ?? null,
    serverName: init?.result?.serverInfo?.name ?? null,
    serverVersion: init?.result?.serverInfo?.version ?? null,
    capabilities: Object.keys(init?.result?.capabilities ?? {}).sort(),
    toolsCount: names.length,
    tools: names,
    resourcesResponse: resources ? (resources.error ? `error:${resources.error.code}` : 'ok') : 'sin-respuesta',
    promptsResponse: prompts ? (prompts.error ? `error:${prompts.error.code}` : 'ok') : 'sin-respuesta',
  }
}

writeFileSync('specs/production-close/s00-baseline/capabilities-by-profile.json', JSON.stringify(result, null, 2))

for (const [name, r] of Object.entries(result)) {
  console.log(`${name}\ttools=${r.toolsCount}\tresources=${r.resourcesResponse}\tprompts=${r.promptsResponse}\tcaps=${r.capabilities.join('|')}`)
}
console.log('---')
console.log('uniones de nombres:', new Set(Object.values(result).flatMap((r) => r.tools)).size)
