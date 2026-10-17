/**
 * Transporte HTTP del MCP con Express.
 *
 * Decisiones clave:
 *  - **Per-session transport**: cada cliente recibe su propio
 *    `StreamableHTTPServerTransport` + `McpServer`, indexados por el header
 *    `Mcp-Session-Id` que genera el SDK en el `initialize`. Sin esto, una
 *    rutina de Routines y una llamada manual del Command Center podrían
 *    pisarse estado mutuamente (capabilities, listas de tools, suscripciones).
 *  - **CORS preflight**: OPTIONS responde 204 con headers CORS ANTES del auth.
 *    Sin esto, browsers y clients JS abortan al recibir 401 al preflight,
 *    sin llegar nunca al POST real.
 *  - **Auth en middleware** antes del dispatcher MCP: un 401/403 se resuelve
 *    sin tocar el protocolo. Allowlist de Origin = mitigación de DNS
 *    rebinding; bearer timing-safe = no revelar la longitud del secreto.
 *  - **Rate limit por token** (no por IP): en producción detrás de un
 *    reverse proxy, la IP sería la del balanceador. El bearer es el
 *    identificador real del cliente.
 *  - **Idle eviction**: sesiones inactivas 30 min se cierran. Evita fugas de
 *    memoria si un cliente abandona la conexión sin limpiar.
 */
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { compareTokens, extractBearer, MIN_TOKEN_LENGTH } from "./auth.js";
import type { Config } from "./config.js";
import { getToolRateClass } from "./http-tool-rate.js";
import {
  registry as metricsRegistry,
  mcpRequestsTotal,
  mcpRequestDuration,
  mcpActiveSessions,
  mcpDryRunMode,
} from "./utils/metrics.js";
import { VERSION } from "./version.js";

/** Tiempo máximo que se espera a cerrar sesiones antes de seguir. */
const SHUTDOWN_DEADLINE_MS = 5_000;

/** Tamaño máximo del cuerpo JSON-RPC. Se aplica ya autenticado. */
const JSON_BODY_LIMIT = "25mb";

/** Métodos JSON-RPC que se etiquetan en las métricas. El resto va a «other». */
const KNOWN_RPC_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "prompts/list",
  "prompts/get",
  "completion/complete",
  "ping",
  "logging/setLevel",
  "unknown",
]);

interface Logger {
  debug: (m: string, e?: unknown) => void;
  info: (m: string, e?: unknown) => void;
  error: (m: string, e?: unknown) => void;
}

export interface HttpAppDeps {
  buildServer: () => McpServer;
  cfg: Config;
  log: Logger;
}

/**
 * Construye la app Express del MCP. Exportada (no inlined en `index.ts`) para
 * poder montarla en tests con `supertest` sin abrir un puerto real, ver
 * `tests/http-transport.test.ts`.
 *
 * Contrato: una sesión MCP = un transport = un McpServer propio. La session id
 * la genera el SDK en el `initialize` y viaja en el header `Mcp-Session-Id` en
 * cada request siguiente.
 */
/**
 * App de Express con una salida ordenada.
 *
 * Se devuelve la app tal cual (supertest y `app.listen` siguen funcionando) con
 * un método añadido: `dispose()`. Cerrar sesiones y transportes antes de salir
 * evita dejar sockets colgando (hallazgo F19).
 */
export interface HttpApp extends Express {
  /** Cierra el temporizador y todas las sesiones, con deadline. */
  dispose: () => Promise<void>;
}

export function buildHttpApp(deps: HttpAppDeps): HttpApp {
  const { buildServer, cfg, log } = deps;
  const expectedToken = cfg.transport.authToken ?? "";
  const allowedOrigins = new Set(cfg.transport.allowedOrigins);

  if (expectedToken.length === 0) {
    throw new Error(
      'HTTP mode requires MCP_AUTH_TOKEN. Sin token, la comparación de ' +
        'credenciales vacías dejaba pasar cualquier petición sin cabecera (F28).',
    );
  }
  if (expectedToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `MCP_AUTH_TOKEN debe tener al menos ${MIN_TOKEN_LENGTH} caracteres.`,
    );
  }

  const app = express();

  // Registro en memoria de sesiones activas. `lastUsed` alimenta la eviction.
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; lastUsed: number }>();

  // Tiered rate limits per tool class (same bearer key across tiers).
  const rateKey = (req: Request) =>
    extractBearer(req.headers.authorization) ||
    ipKeyGenerator(req.ip ?? "") ||
    "anon";

  const readLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateKey,
    message: { error: "rate_limit_exceeded", tier: "read" },
  });

  const writeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateKey,
    message: { error: "rate_limit_exceeded", tier: "write" },
  });

  const auditLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateKey,
    message: { error: "rate_limit_exceeded", tier: "audit" },
  });

  function tieredRateLimit(req: Request, res: Response, next: NextFunction): void {
    const tier = getToolRateClass(req);
    if (tier === "audit") {
      auditLimiter(req, res, next);
      return;
    }
    if (tier === "write") {
      writeLimiter(req, res, next);
      return;
    }
    readLimiter(req, res, next);
  }

  // CORS preflight handler. DEBE ir antes de auth: los clientes web
  // hacen OPTIONS preflight sin Authorization header; si pasa por auth recibe
  // 401 y aborta. Aquí respondemos 204 con headers CORS si el Origin está
  // allowlisted, y dejamos que las requests no-OPTIONS sigan al auth.
  app.use("/mcp", (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Accept");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Gauge de dry-run (valor constante por sesión de vida del proceso).
  mcpDryRunMode.set({}, cfg.agent.dryRun ? 1 : 0);

  // Instrumentación Prometheus para requests MCP.
  // Captura method (del JSON-RPC body), status HTTP y duración.
  function instrumentacion(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    const bodyObj = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : null;
    // La etiqueta sale del CUERPO, así que hay que acotarla: un cliente puede
    // mandar métodos inventados y hacer crecer el registro de métricas sin
    // freno (hallazgo F22). Los conocidos se conservan; el resto, a «other».
    const metodoBruto = (bodyObj && typeof bodyObj["method"] === "string") ? bodyObj["method"] : "unknown";
    const rpcMethod = KNOWN_RPC_METHODS.has(metodoBruto) ? metodoBruto : "other";
    res.on("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const status = String(res.statusCode);
      mcpRequestsTotal.inc({ transport: "http", method: rpcMethod, status });
      mcpRequestDuration.observe({ transport: "http", method: rpcMethod }, durationSeconds);
    });
    next();
  }

  /**
   * Límite barato por ORIGEN, antes de autenticar.
   *
   * El límite por token no sirve aquí: un atacante puede rotar tokens
   * inventados y estrenar cubo en cada intento, así que nunca se le agota
   * (hallazgo F20). Este va por IP y se gasta pase lo que pase.
   */
  const preAuthLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "") || "anon",
    message: { error: "rate_limit_exceeded", tier: "pre-auth" },
  });

  // ORDEN, y por qué:
  //  1. CORS/preflight: los navegadores hacen OPTIONS sin Authorization; si
  //     pasara por auth, abortarían antes del POST real.
  //  2. Límite por IP: barato, antes de cualquier trabajo caro.
  //  3. Auth: fallo cerrado.
  //  4. Parseo del cuerpo: DESPUÉS de auth. Antes, cualquiera podía obligar al
  //     servidor a parsear 25 MB sin credenciales (hallazgo F21).
  //  5. Métricas y límites por token: ya sobre tráfico autenticado.
  /**
   * Anota los rechazos PREVIOS a autenticar, sin leer el cuerpo.
   *
   * Se pierde el detalle del método (no hay body parseado todavía), pero se
   * conserva lo que importa para detectar un ataque: cuántos 401/403/429 se
   * están produciendo. La etiqueta es fija, así que no crece la cardinalidad
   * (hallazgo F22). Los requests autenticados los anota `instrumentacion`, que
   * va después.
   */
  app.use("/mcp", (req: Request, res: Response, next: NextFunction): void => {
    res.on("finish", () => {
      const status = res.statusCode;
      if (status === 401 || status === 403 || status === 429) {
        mcpRequestsTotal.inc({
          transport: "http",
          method: "unauthenticated",
          status: String(status),
        });
      }
    });
    next();
  });

  app.use("/mcp", preAuthLimiter, authMiddleware, express.json({ limit: JSON_BODY_LIMIT }), instrumentacion, tieredRateLimit);

  app.all("/mcp", async (req: Request, res: Response) => {
    const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    try {
      const entry = sessionId ? sessions.get(sessionId) : undefined;

      // Caso 1: request sin sesión válida pero con body `initialize` →
      // creamos transport + server nuevos y los registramos al terminar.
      if (!entry && req.method === "POST" && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            log.debug("MCP session initialized", { id });
          },
        });
        const server = buildServer();
        await server.connect(transport as never);
        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            log.debug("MCP session closed", { id: transport.sessionId });
          }
        };
        await transport.handleRequest(req, res, req.body);
        if (transport.sessionId) {
          sessions.set(transport.sessionId, { transport, server, lastUsed: Date.now() });
        }
        return;
      }

      // Caso 2: request con session id desconocida o body no-initialize →
      // 400 con shape JSON-RPC para que el cliente sepa reinicializar.
      if (!entry) {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session. Send an initialize request first." }, id: null });
        return;
      }

      // Caso 3: sesión existente. Actualizamos lastUsed y delegamos al SDK.
      entry.lastUsed = Date.now();
      await entry.transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("Error handling MCP request", { message: (err as Error).message });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal_error" }, id: null });
      }
    }
  });

  // `/healthz` no pasa por el middleware de auth — lo usan uptime monitors
  // y el healthcheck de Docker. Expone el número de sesiones como métrica
  // barata para detectar fugas o cargas anómalas.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, version: VERSION, sessions: sessions.size });
  });

  // `/metrics` requiere bearer auth (no exposición pública de métricas).
  app.get("/metrics", authMiddleware, (_req: Request, res: Response) => {
    mcpActiveSessions.set({}, sessions.size);
    res.type("text/plain; version=0.0.4").send(metricsRegistry.text());
  });

  // Eviction de sesiones idle. `setInterval().unref()` permite al proceso
  // salir limpiamente aunque el timer esté activo (no bloquea el event loop
  // al cerrar).
  const evictionTimer = setInterval(() => {
    const now = Date.now();
    const idleTimeout = 30 * 60 * 1000;
    for (const [id, entry] of sessions) {
      if (now - entry.lastUsed > idleTimeout) {
        entry.transport.close().catch(() => { /* noop */ });
        sessions.delete(id);
        log.debug("Evicted idle session", { id });
      }
    }
  }, 60_000);
  evictionTimer.unref();

  /**
   * Cierra todo lo que abrió esta app.
   *
   * El deadline importa: un transporte que no responde no debe impedir que el
   * proceso termine. Se intenta cerrar bien y, si no llega, se sigue.
   */
  async function dispose(): Promise<void> {
    clearInterval(evictionTimer);
    const cierres: Promise<unknown>[] = [];
    for (const [id, entry] of sessions) {
      sessions.delete(id);
      cierres.push(
        Promise.resolve(entry.transport.close()).catch(() => { /* noop */ }),
      );
    }
    const deadline = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, SHUTDOWN_DEADLINE_MS);
      t.unref();
    });
    await Promise.race([Promise.allSettled(cierres), deadline]);
  }

  return Object.assign(app, { dispose });

  /**
   * Auth middleware. Orden y efectos:
   *  1. Si el cliente envía `Origin` y tenemos allowlist, validamos. Sin
   *     `Origin` (caso típico de cliente CLI o backend) aceptamos: no todos
   *     los clientes MCP envían el header, y el bearer ya es suficiente para
   *     los no-navegadores.
   *  2. Bearer comparado timing-safe (ver `auth.ts`). Fail-closed.
   */
  function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    const token = extractBearer(req.headers.authorization);
    if (!compareTokens(token, expectedToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  }
}
