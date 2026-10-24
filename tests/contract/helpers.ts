/**
 * Helpers compartidos para tests de contrato MCP (`tests/contract/`).
 *
 * Enfoque real (Option A): en lugar de inspeccionar campos internos del SDK
 * (`_registeredTools`), construye la app HTTP real vía `buildHttpApp` con el
 * `buildServer` agente (todas las tools) y consulta `tools/list` a través del
 * transport HTTP — exactamente como lo haría un cliente MCP real. Los adapters
 * están mockeados (vi.mock, declarado en cada test file) para que el build no
 * abra conexiones a Bridge/GreenMail.
 */
import type { Express } from "express";
import request from "supertest";
import type { Config } from "../../src/config.js";
import { buildHttpApp } from "../../src/http.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../../src/server.js";

export interface ContractLogger {
  error: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
  info: (m: string, e?: unknown) => void;
  debug: (m: string, e?: unknown) => void;
}

export const silentLog: ContractLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

export const AUTH_TOKEN = "expected-token-para-pruebas";

/** Config válida que habilita productos activos → 47 tools por defecto. */
export function makeContractCfg(overrides?: Partial<Config>): Config {
  return {
    products: {
      mail: {
        enabled: true,
        bridge: {
          user: "contract@example.com",
          pass: "contract-secret",
          host: "127.0.0.1",
          imapPort: 1143,
          smtpPort: 1025,
          from: "contract@example.com",
          tlsInsecure: true,
          imapSecurity: "starttls", smtpSecurity: "starttls",
        },
      },
      pass: { enabled: true, storeDir: "/tmp/test-pass-contract" },
      calendar: { enabled: true, experimental: false },
      drive: {
        enabled: true,
        cliBin: "proton-drive",
        stagingDir: "/tmp/test-drive-contract",
        obsoleteExtensions: [],
      },
    },
    transport: {
      kind: "http",
      httpHost: "127.0.0.1",
      httpPort: 8787,
      authToken: AUTH_TOKEN,
      allowedOrigins: [],
    },
    alerts: { enabled: false, logDir: "logs", minSeverity: "warning" },
    agent: { dryRun: true, maxInspectEmails: 1000, minConfidence: 0.6 },
    // Las pruebas NO deben escribir estado en el repo: directorio temporal.
    authz: {
      mode: "enforce",
      actor: "contract",
      approvalDir: mkdtempSync(join(tmpdir(), "contract-authz-")),
      journalFile: null,
      allow: ["read"],
      requireApproval: ["write", "destructive", "admin"],
    },
    logLevel: "error",
    ...overrides,
  };
}

/** Shape client-facing de una tool tal como la ve un cliente MCP. */
export interface ClientTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
  execution?: Record<string, unknown>;
}

/**
 * App Express de test: `buildServer` real con todos los products → registra
 * las 47 tools por defecto (50 con Calendar experimental). Los adapters están mockeados en cada test file.
 */
export function buildContractApp(cfgOverrides?: Partial<Config>): Express {
  const cfg = makeContractCfg(cfgOverrides);
  return buildHttpApp({
    buildServer: () => buildServer(cfg, silentLog).server,
    cfg,
    log: silentLog,
  });
}

/**
 * Parsea texto `text/event-stream` (SSE) en un arreglo de objetos JSON.
 * El transport HTTP de MCP usa frames `event: message` + `data: <json>`.
 */
function parseSSE(text: string): unknown[] {
  const messages: unknown[] = [];
  let data = "";
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      data += line.slice(5).trimStart();
    } else if (line === "" && data) {
      try {
        messages.push(JSON.parse(data));
      } catch {
        /* noop: línea de datos no-JSON ignorada */
      }
      data = "";
    }
  }
  if (data) {
    try {
      messages.push(JSON.parse(data));
    } catch {
      /* noop */
    }
  }
  return messages;
}

/**
 * Supertest: `initialize` → captura session id → `tools/list`. Parsea la
 * respuesta SSE y devuelve las `tools` client-facing (con inputSchema JSON).
 */
export async function listContractTools(
  cfgOverrides?: Partial<Config>,
): Promise<ClientTool[]> {
  const app = buildContractApp(cfgOverrides);
  const initRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${AUTH_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract", version: "1" } },
    });
  if (initRes.status !== 200) {
    throw new Error(`initialize failed: ${initRes.status} ${initRes.text}`);
  }
  const sessionId = initRes.headers["mcp-session-id"];
  if (!sessionId) throw new Error("missing mcp-session-id header");

  const res = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${AUTH_TOKEN}`)
    .set("Mcp-Session-Id", sessionId)
    .set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  if (res.status !== 200) {
    throw new Error(`tools/list failed: ${res.status} ${res.text}`);
  }

  const messages = parseSSE(res.text || "");
  const listing = messages.find(
    (m): m is { result?: { tools?: ClientTool[] } } =>
      m != null && typeof m === "object" && "result" in m,
  );
  const tools = listing?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`tools/list did not return tools array: ${JSON.stringify(res.text).slice(0, 300)}`);
  }
  return tools;
}
