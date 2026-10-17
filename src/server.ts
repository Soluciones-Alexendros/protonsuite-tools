/**
 * Registro de las MCP tools sobre un `McpServer`.
 *
 * El inventario NO es fijo: depende de qué productos estén habilitados. Un
 * producto apagado no registra sus tools (ver `enabled` por grupo y
 * `specs/production-close/probe-capabilities.mjs`).
 *
 * Convenciones aplicadas a TODAS las tools:
 *  - **`inputSchema` con Zod**: el SDK convierte el schema Zod a JSON Schema
 *    draft-07 y lo expone en `tools/list`. El modelo ve tipos, descripciones
 *    y defaults — puede construir llamadas válidas sin adivinar.
 *  - **`annotations`**: cada tool declara al menos `readOnlyHint` y
 *    `openWorldHint`. Las mutativas añaden `destructiveHint` o
 *    `idempotentHint`. Esto permite al cliente MCP (y al humano que lo audita)
 *    razonar sobre efectos sin leer el handler.
 *  - **`response_format: "markdown" | "json"`** en las tools de lectura. Por
 *    defecto markdown — más natural para el modelo al resumir. JSON cuando
 *    el consumidor es un backend (ver `fetchUnreadSummary` en el Command
 *    Center).
 *
 * Instrucciones del servidor: el `instructions` que se pasa al constructor es
 * contexto que el modelo VE al listar tools. Por eso recordamos la necesidad
 * de llamar primero a `proton_list_folders` y de usar UIDs (no seq numbers).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AlertSystem } from './alerts/index.js'
import { BridgeClient } from './bridge/bridge-client.js'
import { type createLogger, type Config } from './config.js'
import { DriveClient } from './drive.js'
import { ImapClient } from './imap.js'
import { PassClient } from './pass.js'
import { registerAgentTools } from './server/agent.js'
import { registerBridgeTools } from './server/bridge.js'
import { registerCalendarTools } from './server/calendar.js'
import { registerDriveTools } from './server/drive.js'
import { registerEcosystemTools } from './server/ecosystem.js'
import { registerMailTools } from './server/mail.js'
import { registerPassTools } from './server/pass.js'
import { registerSuiteTool } from './server/suite.js'
import { SmtpClient } from './smtp.js'
import { VERSION } from './version.js'

type Logger = ReturnType<typeof createLogger>

export function buildServer(
  cfg: Config,
  log: Logger,
): {
  server: McpServer
  imap: ImapClient
  smtp: SmtpClient
  drive?: DriveClient
} {
  const bridgeCfg = cfg.products.mail.bridge
  let passwordResolver: () => Promise<string>
  if (cfg.products.pass.enabled && bridgeCfg.passPath) {
    const passClient = new PassClient(
      {
        storeDir: cfg.products.pass.storeDir,
        backend: cfg.products.pass.backend ?? 'pass',
      },
      log,
    )
    const passPath = bridgeCfg.passPath
    passwordResolver = () => passClient.get(passPath)
  } else {
    passwordResolver = () => Promise.resolve(bridgeCfg.pass)
  }
  const resolvedBridgeCfg = { ...bridgeCfg, passwordResolver }

  const imap = new ImapClient(resolvedBridgeCfg, log)
  const smtp = new SmtpClient(resolvedBridgeCfg, log)

  const server = new McpServer(
    { name: 'protonsuite-agent', version: VERSION },
    {
      instructions:
        'Proton Suite agent with multiple products. Mail: via Proton Mail Bridge (IMAP/SMTP) — call proton_list_folders first, use UIDs. Pass: via pass-cli — never returns secret values, only confirms found/generated. Drive: via proton-drive CLI — staging directory is a local workspace, not a rclone mirror. Calendar stub. Before any write operation, review the plan in read-only mode.',
    },
  )

  // Wrapper de registro con traza por handler. `register` comparte la firma
  // (sobrecargada y genérica) de `server.registerTool`, así que cada call-site
  // conserva el tipado de `args` inferido desde su inputSchema; el casting a
  // `any` queda confinado aquí. Emite un `debug` con { tool, ms } al terminar
  // (éxito o error) — sin volcar args, que pueden traer cuerpos o direcciones.
  const register: typeof server.registerTool = ((name, config, cb) =>
    server.registerTool(
      name,
      config as never,
      (async (...callArgs: unknown[]) => {
        const startedAt = Date.now()
        try {
          return await (cb as (...a: unknown[]) => Promise<unknown>)(
            ...callArgs,
          )
        } finally {
          log.debug('tool', { tool: name, ms: Date.now() - startedAt })
        }
      }) as never,
    )) as typeof server.registerTool

  // ---------------------------------------------------------------------------
  // Registro de tools agrupado por dominio funcional. Cada helper encapsula el
  // register de su grupo; los handlers capturan `imap`/`smtp` por closure, así
  // que el cuerpo de `buildServer` solo orquesta.
  //
  // GATING: cada grupo que depende de un producto se registra SOLO si el
  // producto está habilitado. Registrar tools de un producto apagado las hacía
  // invocables y anunciadas, y el operador no podía deshabilitarlo (F18).
  // ---------------------------------------------------------------------------
  const alerts = new AlertSystem(cfg.alerts, log)

  if (cfg.products.mail.enabled) {
    registerMailTools(server, { cfg, log, imap, smtp })
    registerAgentTools(server, { cfg, log, alerts })
  }

  let driveClient: DriveClient | undefined
  if (cfg.products.drive.enabled) {
    driveClient = new DriveClient(cfg.products.drive, log)
  }

  let passClient: PassClient | undefined
  if (cfg.products.pass.enabled) {
    passClient = new PassClient(
      {
        storeDir: cfg.products.pass.storeDir,
        backend: cfg.products.pass.backend ?? 'pass',
      },
      log,
    )
  }

  registerPassTools(server, { cfg, log })
  registerCalendarTools(server, { log, enabled: cfg.products.calendar.enabled, experimental: cfg.products.calendar.experimental })
  registerDriveTools(server, { cfg, log, driveClient })
  registerSuiteTool(server, { cfg, log, imap, driveClient, passwordResolver, bridgeCfg, passClient })
  registerEcosystemTools(server, { log })

  if (cfg.products.mail.enabled) {
    const bridgeClient = new BridgeClient('protonmail-bridge-core', log)
    registerBridgeTools(register, bridgeClient, log)
  }

  return {
    server,
    imap,
    smtp,
    ...(driveClient !== undefined ? { drive: driveClient } : {}),
  }


}

// ---------------------------------------------------------------------------
// Bridge tools — migrated to src/server/bridge.ts
// ---------------------------------------------------------------------------
