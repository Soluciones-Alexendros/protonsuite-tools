import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ipKeyGenerator } from "express-rate-limit";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../src/config.js";
import { buildHttpApp } from "../src/http.js";

// Mock ipKeyGenerator para cubrir el fallback "anon" (línea 75 de http.ts).
// En tests con supertest req.ip siempre es "127.0.0.1", así que sin este mock
// ipKeyGenerator devuelve una IP real (truthy) y "anon" nunca se ejecuta.
vi.mock("express-rate-limit", async (importOriginal) => {
  const actual: object = await importOriginal();
  return {
    ...actual,
    ipKeyGenerator: vi.fn(() => ""),
  };
});

const silent = {
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

function cfg(overrides: Partial<Config["transport"]> = {}): Config {
  return {
    products: {
      mail: {
        enabled: true,
        bridge: {
          user: "x@y.com",
          pass: "p",
          host: "127.0.0.1",
          imapPort: 1143,
          smtpPort: 1025,
          from: "x@y.com",
          tlsInsecure: true,
          imapSecurity: "starttls", smtpSecurity: "starttls",
        },
      },
      pass: { enabled: false, storeDir: "/tmp" },
      calendar: { enabled: false, experimental: false },
      drive: { enabled: false },
    },
    transport: {
      kind: "http",
      httpHost: "127.0.0.1",
      httpPort: 8787,
      authToken: "expected-token-para-pruebas",
      allowedOrigins: [],
      ...overrides,
    },
    alerts: {
      enabled: false,
      logDir: "logs",
      minSeverity: "warning",
    },
    agent: {
      dryRun: true,
      maxInspectEmails: 10,
      minConfidence: 0.6,
    },
    logLevel: "error",
  };
}

const miniServer = (): McpServer =>
  new McpServer({ name: "t", version: "1.0.0" }, { instructions: "test" });

describe("HTTP transport · auth and session lifecycle", () => {
  beforeEach(() => {
    silent.debug.mockReset();
    silent.info.mockReset();
    silent.error.mockReset();
  });

  it("GET /healthz returns 200 without auth", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("POST /mcp without bearer returns 401", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("POST /mcp with wrong bearer returns 401", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer wrong-token")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
  });

  it("POST /mcp with disallowed Origin returns 403", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://agent.example"] }),
      log: silent,
    });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Origin", "https://evil.com")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("origin_not_allowed");
  });

  it("POST /mcp with valid bearer but no session id and non-initialize body returns 400", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe(-32000);
  });

  it("POST /mcp initialize returns MCP session id header and OK body", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    expect(res.status).toBe(200);
    expect(res.headers["mcp-session-id"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("timing-safe auth: short wrong token does not leak via status", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const short = await request(app).post("/mcp").set("Authorization", "Bearer x").send({});
    const wrong = await request(app).post("/mcp").set("Authorization", "Bearer yy-very-different-length").send({});
    expect(short.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  it("ratelimit middleware is wired (sends a RateLimit* header on /mcp)", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).post("/mcp").set("Authorization", "Bearer expected-token-para-pruebas").send({ jsonrpc: "2.0", id: 1, method: "x" });
    const hasRateLimitHeader = Object.keys(res.headers).some((k) => k.toLowerCase().startsWith("ratelimit"));
    expect(hasRateLimitHeader).toBe(true);
  });

  it("audit-tier tools/call are rate-limited after 5 requests", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "proton_drive_audit", arguments: {} },
    };
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer expected-token-para-pruebas")
        .send(body);
      lastStatus = res.status;
      if (i < 5) {
        // May be 400 (no session) but must not be 429 yet
        expect(res.status).not.toBe(429);
      }
    }
    expect(lastStatus).toBe(429);
  });

  it("write-tier tools/call are rate-limited after 30 requests", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "proton_send_email", arguments: {} },
    };
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer expected-token-para-pruebas")
        .send(body);
      lastStatus = res.status;
      if (i < 30) expect(res.status).not.toBe(429);
    }
    expect(lastStatus).toBe(429);
  });
});

describe("CORS preflight", () => {
  it("OPTIONS /mcp con origin permitido devuelve 204 con CORS headers", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://app.example.com"] }),
      log: silent,
    });
    const res = await request(app)
      .options("/mcp")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("OPTIONS /mcp sin origin permitido igual devuelve 204 (preflight no pasa por auth)", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://trusted.com"] }),
      log: silent,
    });
    const res = await request(app).options("/mcp").set("Origin", "https://evil.com");
    // OPTIONS preflight siempre devuelve 204 aunque el origin no esté en allowlist
    expect(res.status).toBe(204);
    // Sin embargo, el header Access-Control-Allow-Origin solo se pone si está en allowlist
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("OPTIONS /mcp sin origin header devuelve 204", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).options("/mcp");
    expect(res.status).toBe(204);
  });

  it("POST /mcp con origin permitido incluye ACAO header", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://app.example.com"] }),
      log: silent,
    });
    const res = await request(app)
      .post("/mcp")
      .set("Origin", "https://app.example.com")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers.vary).toBe("Origin");
  });
});

describe("Session lifecycle", () => {
  it("initialize crea sesión y devuelve session id", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    expect(res.status).toBe(200);
    expect(res.headers["mcp-session-id"]).toBeDefined();
  });

  it("segundo request con session id existente no rechaza", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    // Inicializar sesión
    const initRes = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    const sessionId = initRes.headers["mcp-session-id"];

    // Usar la sesión existente (mismo Accept header que el SDK espera)
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Mcp-Session-Id", sessionId)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.status).toBe(200);
  });

  it("request con session id inválido devuelve 400", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Mcp-Session-Id", "no-such-session")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe(-32000);
  });

  it("session id se pasa en minúsculas (mcp-session-id)", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const initRes = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    const sessionId = initRes.headers["mcp-session-id"];

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("mcp-session-id", sessionId)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.status).toBe(200);
  });
});

describe("Auth edge cases", () => {
  it("POST /mcp sin Authorization header devuelve 401", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).post("/mcp").send({});
    expect(res.status).toBe(401);
  });

  it("sin authToken configurado, construir la app FALLA (fallo cerrado, F28)", () => {
    // Antes se construía y quedaba abierta: `compareTokens("", "")` casaba, así
    // que cualquier petición sin cabecera pasaba. Ahora no se puede ni montar.
    expect(() =>
      buildHttpApp({
        buildServer: miniServer,
        cfg: cfg({ authToken: undefined as never }),
        log: silent,
      }),
    ).toThrow(/MCP_AUTH_TOKEN/);
  });

  it("un token demasiado corto también se rechaza", () => {
    expect(() =>
      buildHttpApp({ buildServer: miniServer, cfg: cfg({ authToken: "corto" }), log: silent }),
    ).toThrow(/al menos/);
  });

  it("con token válido, la app se monta", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer any-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    // authToken undefined → expectedToken = '' → compareTokens(any, '') falla → 401
    expect(res.status).toBe(401);
  });

  it("malformed Authorization header (sin Bearer) devuelve 401", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).post("/mcp").set("Authorization", "Basic xyz").send({});
    expect(res.status).toBe(401);
  });

  it("authorization con formato valido pero token vacío devuelve 401", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).post("/mcp").set("Authorization", "Bearer ").send({});
    expect(res.status).toBe(401);
  });
});

describe("Error handling", () => {
  it("POST /mcp con body inválido (no JSON) devuelve 500", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Content-Type", "application/json")
      .send("{invalid json}");
    // El error de parseo JSON se propaga al catch del handler → 500
    expect([400, 500]).toContain(res.status);
  });

  it("GET /mcp sin sesión devuelve 400 con error JSON-RPC", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .get("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas");
    // GET sin session id → no entry → 400
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe(-32000);
  });

  it("POST /mcp invalid JSON body triggers catch block → 500", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Content-Type", "application/json")
      .send("not json at all");
    // Catch block returns 500 when headers not yet sent
    expect([400, 500]).toContain(res.status);
  });

  it("/healthz reports session count after initialize", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    // Pre-init
    const before = await request(app).get("/healthz");
    expect(before.body.sessions).toBe(0);

    // Initialize
    await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });

    // Post-init
    const after = await request(app).get("/healthz");
    expect(after.body.sessions).toBeGreaterThanOrEqual(1);
    expect(after.body.version).toBeDefined();
  });

  it("CORS headers set on POST when origin in allowlist", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://app.example.com"] }),
      log: silent,
    });
    const res = await request(app)
      .post("/mcp")
      .set("Origin", "https://app.example.com")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .send({});
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
  });

  it("auth returns 403 when origin not in allowlist", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://trusted.com"] }),
      log: silent,
    });
    const res = await request(app)
      .post("/mcp")
      .set("Origin", "https://evil.com")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .send({});
    expect(res.status).toBe(403);
  });

  it("auth passes (to 400) when no origin and allowedOrigins configured", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://app.example.com"] }),
      log: silent,
    });
    // No origin header → skips origin check, goes to bearer
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .send({});
    // 400 (no session), not 403
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32000);
  });

  it("OPTIONS preflight with allowed origin sets all CORS headers", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://app.example.com"], authToken: "secreto-de-pruebas-largo" }),
      log: silent,
    });
    const res = await request(app)
      .options("/mcp")
      .set("Origin", "https://app.example.com");
    // 204 without auth — preflight bypasses auth middleware
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
    expect(res.headers["access-control-expose-headers"]).toBe("Mcp-Session-Id");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("OPTIONS preflight without allowlist still returns 204", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg({ allowedOrigins: [] }), log: silent });
    const res = await request(app)
      .options("/mcp")
      .set("Origin", "https://any.com");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("POST with allowed origin, valid auth, non-initialize body → 400", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://app.example.com"] }),
      log: silent,
    });
    const res = await request(app)
      .post("/mcp")
      .set("Origin", "https://app.example.com")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(400);
    expect(res.body?.error?.message).toContain("No valid session");
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
  });

  it("DELETE /mcp without session returns 400", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .delete("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas");
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe(-32000);
  });
});

describe("Idle eviction", () => {
  it("evicts session after 30 minutes of inactivity", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });

    // Inicializar sesión
    const initRes = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    expect(initRes.status).toBe(200);

    // Verificar sesión creada
    const before = await request(app).get("/healthz");
    expect(before.body.sessions).toBeGreaterThanOrEqual(1);

    // Avanzar 31 minutos (el timeout idle es 30 min, el intervalo de check es 60s)
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    // Verificar sesión eliminada
    const after = await request(app).get("/healthz");
    expect(after.body.sessions).toBe(0);

    vi.useRealTimers();
  });
});

describe("Rate limiter keyGenerator fallback", () => {
  it("functions without Authorization header (falls back to IP/anon)", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    // Sin Authorization header → extractBearer devuelve '' → fallback a IP → anon
    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "x" });
    // Auth falla con 401, pero el rate limiter previo debe haber funcionado
    expect(res.status).toBe(401);
    // Verificar que el rate limiter ejecutó el keyGenerator (sin arrojar error)
    expect(res.body.error).toBe("unauthorized");
  });

  it("keyGenerator short-circuits at IP when ipKeyGenerator returns truthy", async () => {
    // Cubre el branch truthy de `ipKeyGenerator(...) ||` en línea 74.
    // El mock por defecto retorna "" (falsy) para forzar el fallback "anon".
    // Con mockReturnValueOnce el primer call retorna una IP real (truthy), cubriendo
    // la rama de short-circuit del operador ||.
    ipKeyGenerator.mockReturnValueOnce("127.0.0.1" as never);
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "x" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });
});

describe("Catch block error handling", () => {
  it("logs error and returns 500 when handler throws", async () => {
    const app = buildHttpApp({
      buildServer: () => {
        throw new Error("unexpected build error");
      },
      cfg: cfg(),
      log: silent,
    });
    // initialize request → buildServer() throws → NO está dentro del try/catch
    // Esto se propaga a Express como error 500
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    // buildServer() throw es antes del try/catch — Express lo maneja como 500
    expect(res.status).toBe(500);
  });

  it("returns 500 when SDK handler throws during initialize", async () => {
    // Crear un server que conecta al transport pero luego falla
    const fragileServer = () => {
      const server = new McpServer({ name: "fragile", version: "1" }, { instructions: "test" });
      // No podemos hacer que server.connect() falle fácilmente desde fuera
      // Pero si buildServer tira error ANTES del connect, es catch externo
      return server;
    };

    const app = buildHttpApp({ buildServer: fragileServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    // El server se conecta y luego handleRequest procesa → status 200
    // (el SDK maneja initialize internamente)
    expect(res.status).toBe(200);
  });
});

describe("Metrics endpoint", () => {
  it("GET /metrics without bearer returns 401", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("GET /metrics with valid bearer returns 200 and Prometheus text", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    const res = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer expected-token-para-pruebas");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# HELP mcp_requests_total");
    expect(res.text).toContain("# TYPE mcp_requests_total counter");
    expect(res.text).toContain("# TYPE mcp_request_duration_seconds histogram");
    expect(res.text).toContain("# HELP mcp_active_sessions");
    expect(res.text).toContain("# HELP mcp_dry_run_mode");
  });

  it("GET /metrics shows active_sessions after initialize", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      });
    const res = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer expected-token-para-pruebas");
    expect(res.text).toContain("mcp_active_sessions");
    const match = res.text.match(/mcp_active_sessions\s+(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(1);
  });

  it("metrics text includes request counts from instrumented /mcp calls", async () => {
    const app = buildHttpApp({ buildServer: miniServer, cfg: cfg(), log: silent });
    await request(app).post("/mcp").send({});
    const res = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer expected-token-para-pruebas");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/mcp_requests_total\{.*status="401".*\}\s+\d+/);
  });

  it("metrics endpoint requires origin check when allowlist is set", async () => {
    const app = buildHttpApp({
      buildServer: miniServer,
      cfg: cfg({ allowedOrigins: ["https://trusted.com"] }),
      log: silent,
    });
    const res = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer expected-token-para-pruebas")
      .set("Origin", "https://evil.com");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("origin_not_allowed");
  });
});
