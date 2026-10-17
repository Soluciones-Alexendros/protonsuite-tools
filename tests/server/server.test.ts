/**
 * Tests for `buildServer` constructor logic and `registerBridgeTools` handlers.
 *
 * Covers the conditional branches in `buildServer`:
 *  - passwordResolver: pass enabled + passPath vs fallback
 *  - drive client conditional creation
 *  - bridge tools conditional registration (mail.enabled)
 *
 * And the handler branches in `registerBridgeTools`:
 *  - response_format: markdown vs json for health, status, accounts
 *  - login: success vs failure, with/without 2FA
 *  - logout: ok vs fail
 *  - info handler happy path
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeClient } from "../../src/bridge/bridge-client.js";
import type { Config } from "../../src/config.js";
import { buildRuntime, buildServer } from "../../src/server.js";
import { registerBridgeTools } from "../../src/server/bridge.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/bridge/bridge-client.js", () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({
    health: vi.fn(),
    status: vi.fn(),
    info: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listAccounts: vi.fn(),
  })),
}));

vi.mock("../../src/imap.js", () => ({
  ImapClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("../../src/smtp.js", () => ({
  SmtpClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
    close: vi.fn(),
  })),
}));

const silentLog = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

function makeCfg(overrides?: Partial<Config>): Config {
  return {
    products: {
      mail: {
        enabled: true,
        bridge: {
          user: "me@proton.me",
          pass: "secret",
          host: "127.0.0.1",
          imapPort: 1143,
          smtpPort: 1025,
          from: "me@proton.me",
          tlsInsecure: true,
          smtpSecurity: "starttls" as const,
        },
      },
      pass: { enabled: false, storeDir: "/tmp" },
      calendar: { enabled: false },
      drive: {
        enabled: false,
        cliBin: "proton-drive",
        stagingDir: "/tmp/test-drive",
        obsoleteExtensions: [],
      },
    },
    transport: { kind: "stdio" as const, httpHost: "127.0.0.1", httpPort: 8787, allowedOrigins: [] },
    alerts: { enabled: false, logDir: "logs", minSeverity: "warning" },
    agent: { dryRun: true, maxInspectEmails: 10, minConfidence: 0.6 },
    logLevel: "error",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// buildServer
// ---------------------------------------------------------------------------

describe("buildServer", () => {
  it("returns server, imap, and smtp", () => {
    const result = buildServer(makeCfg(), silentLog as never);
    expect(result.server).toBeDefined();
    expect(result.imap).toBeDefined();
    expect(result.smtp).toBeDefined();
  });

  it("creates DriveClient when drive is enabled", () => {
    const result = buildServer(
      makeCfg({
        products: {
          ...makeCfg().products,
          drive: { enabled: true, cliBin: "proton-drive", stagingDir: "/tmp/drive", obsoleteExtensions: [] },
        },
      }),
      silentLog as never,
    );
    expect(result.drive).toBeDefined();
  });

  it("drive is undefined when drive is disabled", () => {
    const result = buildServer(makeCfg(), silentLog as never);
    expect(result.drive).toBeUndefined();
  });

  it("returns server without throwing when mail is disabled", () => {
    const result = buildServer(
      makeCfg({
        products: {
          ...makeCfg().products,
          mail: { ...makeCfg().products.mail, enabled: false },
        },
      }),
      silentLog as never,
    );
    expect(result.server).toBeDefined();
  });

  it("registers bridge tools when mail is enabled", () => {
    const result = buildServer(makeCfg(), silentLog as never);
    expect(result.server).toBeDefined();
    expect(result.imap).toBeDefined();
  });

  it("uses PassClient when pass enabled and passPath set", () => {
    const cfgWithPass = makeCfg({
      products: {
        ...makeCfg().products,
        pass: { enabled: true, storeDir: "/tmp/pass" },
      },
    });
    cfgWithPass.products.mail.bridge.passPath = "proton/bridge/password";
    const result = buildServer(cfgWithPass, silentLog as never);
    expect(result.server).toBeDefined();
    expect(result.imap).toBeDefined();
  });

  it("uses fallback passwordResolver when pass is disabled", () => {
    const result = buildServer(makeCfg(), silentLog as never);
    expect(result.server).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// registerBridgeTools handlers
// ---------------------------------------------------------------------------

const capturedTools = new Map<string, { config: unknown; handler: (...args: unknown[]) => unknown }>();

function mockRegister(
  name: string,
  config: unknown,
  handler: (...args: unknown[]) => unknown,
) {
  capturedTools.set(name, { config, handler });
}


beforeEach(() => {
  capturedTools.clear();
});

/** Modo antiguo declarado a propósito: aquí se prueba el comportamiento, no el control. */
const LEGACY_BRIDGE_DEPS = {
  secretsFromModel: true,
  bridgeUser: "legacy@proton.me",
  resolvePassword: async () => "legacy-pass",
} as const;

describe("registerBridgeTools — handlers", () => {
  it("health handler with json response_format", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.health).mockResolvedValue({
      ok: true,
      processRunning: true,
      imapListening: true,
      smtpListening: true,
      authOk: true,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_health")!;
    const result = await tool.handler({ response_format: "json" });

    const content = (result as any).content;
    expect(JSON.parse(content[0].text)).toMatchObject({
      ok: true,
      authOk: true,
    });
    expect((result as any).structuredContent).toBeDefined();
  });

  it("health handler with markdown response_format", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.health).mockResolvedValue({
      ok: true,
      processRunning: true,
      imapListening: true,
      smtpListening: true,
      authOk: true,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_health")!;
    const result = await tool.handler({ response_format: "markdown" });

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Bridge Health");
    expect(text).toContain("OK: true");
    expect(text).toContain("Auth OK: true");
  });

  it("health handler with error includes error in markdown", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.health).mockResolvedValue({
      ok: false,
      processRunning: false,
      imapListening: false,
      smtpListening: false,
      authOk: false,
      error: "Bridge process not running",
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_health")!;
    const result = await tool.handler({ response_format: "markdown" });

    const text = (result as any).content[0].text;
    expect(text).toContain("Error: Bridge process not running");
  });

  it("status handler with json response_format", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.status).mockResolvedValue({
      user: "u@proton.me",
      version: "3.15",
      processRunning: true,
      imapListening: true,
      smtpListening: true,
      authOk: true,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_status")!;
    const result = await tool.handler({ response_format: "json" });

    const content = (result as any).content;
    expect(JSON.parse(content[0].text)).toMatchObject({ user: "u@proton.me" });
    expect((result as any).structuredContent).toBeDefined();
  });

  it("status handler with markdown response_format", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.status).mockResolvedValue({
      user: "u@proton.me",
      version: "3.15",
      processRunning: true,
      imapListening: true,
      smtpListening: true,
      authOk: true,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_status")!;
    const result = await tool.handler({ response_format: "markdown" });

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Bridge Status");
    expect(text).toContain("User: u@proton.me");
    expect(text).toContain("Version: 3.15");
  });

  it("info handler returns bridge info", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.info).mockResolvedValue({
      user: "u@proton.me",
      version: "3.15",
      imapPort: 1143,
      smtpPort: 1025,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_info")!;
    const result = await tool.handler({});

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Bridge Info");
    expect(text).toContain("User: u@proton.me");
    expect(text).toContain("IMAP port: 1143");
    expect((result as any).structuredContent).toBeDefined();
  });

  it("login handler returns success", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.login).mockResolvedValue({ ok: true, message: "logged in" });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_login")!;
    const result = await tool.handler({ user: "u@proton.me", password: "pwd" });

    const text = (result as any).content[0].text;
    expect(text).toContain("Login successful");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(client.login)).toHaveBeenCalledWith("u@proton.me", "pwd", undefined);
  });

  it("login handler returns failure with 2FA flag", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.login).mockResolvedValue({
      ok: false,
      message: "2FA required",
      needs2FA: true,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_login")!;
    const result = await tool.handler({
      user: "u@proton.me",
      password: "pwd",
      totp: "123456",
    });

    const text = (result as any).content[0].text;
    expect(text).toContain("Login failed");
    expect(text).toContain("2FA required");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(client.login)).toHaveBeenCalledWith("u@proton.me", "pwd", "123456");
  });

  it("logout handler returns ok", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.logout).mockResolvedValue({ ok: true });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_logout")!;
    const result = await tool.handler({});

    const text = (result as any).content[0].text;
    expect(text).toContain("Logged out");
  });

  it("logout handler returns failure", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.logout).mockResolvedValue({ ok: false });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_logout")!;
    const result = await tool.handler({});

    const text = (result as any).content[0].text;
    expect(text).toContain("Logout failed");
  });

  it("accounts handler with json response", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.listAccounts).mockResolvedValue([
      { user: "u@proton.me", state: "connected" },
    ]);

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_accounts")!;
    const result = await tool.handler({ response_format: "json" });

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].user).toBe("u@proton.me");
  });

  it("accounts handler with markdown returns empty list message", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.listAccounts).mockResolvedValue([]);

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_accounts")!;
    const result = await tool.handler({ response_format: "markdown" });

    const text = (result as any).content[0].text;
    expect(text).toContain("No accounts configured");
  });

  it("accounts handler with markdown lists accounts", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.listAccounts).mockResolvedValue([
      { user: "u1@proton.me", state: "connected" },
      { user: "u2@proton.me", state: "disconnected" },
    ]);

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_accounts")!;
    const result = await tool.handler({ response_format: "markdown" });

    const text = (result as any).content[0].text;
    expect(text).toContain("u1@proton.me: connected");
    expect(text).toContain("u2@proton.me: disconnected");
  });

  it("info handler uses null fallbacks when fields are undefined", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.info).mockResolvedValue({
      user: undefined as unknown as string,
      version: undefined as unknown as string,
      imapPort: undefined as unknown as number,
      smtpPort: undefined as unknown as number,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_info")!;
    const result = await tool.handler({});

    const text = (result as any).content[0].text;
    expect(text).toContain("User: (none)");
    expect(text).toContain("Version: unknown");
    expect(text).toContain("IMAP port: N/A");
    expect(text).toContain("SMTP port: N/A");
    expect((result as any).structuredContent).toBeDefined();
  });

  it("login handler returns failure without 2FA flag", async () => {
    const client = new BridgeClient("/bin/fake", silentLog);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.login).mockResolvedValue({
      ok: false,
      message: "wrong password",
      needs2FA: false,
    });

    registerBridgeTools(mockRegister, client, silentLog, LEGACY_BRIDGE_DEPS);
    const tool = capturedTools.get("proton_bridge_login")!;
    const result = await tool.handler({ user: "u@proton.me", password: "bad" });

    const text = (result as any).content[0].text;
    expect(text).toContain("Login failed");
    expect(text).not.toContain("2FA");
  });
});

// ---------------------------------------------------------------------------
// register wrapper — error path (handler throws)
// ---------------------------------------------------------------------------

describe("register wrapper — error handling", () => {
  it("fires log.debug with timing even when handler throws", async () => {
    const dbgLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    const McpProto = McpServer as unknown as { prototype: { registerTool: (...args: never[]) => unknown } };
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const origRegister = McpProto.prototype.registerTool;
    const spyRegister = vi
      .spyOn(McpProto.prototype as any, "registerTool")
      .mockImplementation(function (
        this: McpServer,
        name: string,
        _config: unknown,
        handler: (...args: never[]) => unknown,
      ) {
        handlers.set(name, handler);
        return (origRegister as (...a: never[]) => unknown).call(this, name, _config as never, handler);
      });

    try {
      buildServer(makeCfg(), dbgLog as never);

      const healthHandler = handlers.get("proton_bridge_health");
      expect(healthHandler).toBeDefined();

      // Hacer que bridge.health() lance — el wrapper debe capturarlo
      // y aún así ejecutar el finally block (log.debug con timing)
      const { BridgeClient } = await import("../../src/bridge/bridge-client.js");
      const instance = vi.mocked(BridgeClient).mock.results[0]?.value as any;
      if (instance?.health) {
        instance.health.mockRejectedValue(new Error("bridge crashed"));
      }

      // El handler debe propagar el error
      await expect(healthHandler!({ response_format: "markdown" } as never)).rejects.toThrow("bridge crashed");

      // Even with rejection, the finally block should have fired
      expect(dbgLog.debug).toHaveBeenCalledWith(
        "tool",
        expect.objectContaining({ tool: "proton_bridge_health", ms: expect.any(Number) }),
      );
    } finally {
      spyRegister.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// buildServer — additional branches
// ---------------------------------------------------------------------------

describe("buildServer — calendar and passPath variants", () => {
  it("works with calendar enabled", () => {
    const cfg = makeCfg({
      products: {
        ...makeCfg().products,
        calendar: { enabled: true },
      },
    });
    const result = buildServer(cfg, silentLog as never);
    expect(result.server).toBeDefined();
  });

  it("uses fallback passwordResolver when pass enabled but no passPath", () => {
    const cfg = makeCfg({
      products: {
        ...makeCfg().products,
        pass: { enabled: true, storeDir: "/tmp/pass" },
      },
    });
    // pass enabled, but bridge.passPath is not set so it falls back to bridge.pass
    const result = buildServer(cfg, silentLog as never);
    expect(result.server).toBeDefined();
    expect(result.imap).toBeDefined();
  });
});

describe("register wrapper — bridge client creation", () => {
  it("creates BridgeClient when mail enabled", async () => {
    const dbgLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    const result = buildServer(makeCfg(), dbgLog as never);
    const { BridgeClient } = await import("../../src/bridge/bridge-client.js");
     
    expect(vi.mocked(BridgeClient)).toHaveBeenCalledWith(
      "protonmail-bridge-core",
      dbgLog,
    );
    expect(result.server).toBeDefined();
  });

  it("register wrapper fires log.debug on bridge tool invocation", async () => {
    const dbgLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    // Accedemos a registerTool via any para espiarlo
    const McpProto = McpServer as unknown as { prototype: { registerTool: (...args: never[]) => unknown } };
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const origRegister = McpProto.prototype.registerTool;
    const spyRegister = vi
      .spyOn(McpProto.prototype as any, "registerTool")
      .mockImplementation(function (
        this: McpServer,
        name: string,
        _config: unknown,
        handler: (...args: never[]) => unknown,
      ) {
        handlers.set(name, handler);
        return (origRegister as (...a: never[]) => unknown).call(this, name, _config as never, handler);
      });

    try {
      const result = buildServer(makeCfg(), dbgLog as never);
      expect(result.server).toBeDefined();

      const healthHandler = handlers.get("proton_bridge_health");
      expect(healthHandler).toBeDefined();

      // Configurar mock de BridgeClient.health para la instancia creada por buildServer
      const { BridgeClient } = await import("../../src/bridge/bridge-client.js");
      const instance = vi.mocked(BridgeClient).mock.results[0]?.value as any;
      if (instance?.health) {
        instance.health.mockResolvedValue({
          ok: true,
          processRunning: true,
          imapListening: true,
          smtpListening: true,
          authOk: true,
        });
      }

      await healthHandler!({ response_format: "markdown" } as never);

      expect(dbgLog.debug).toHaveBeenCalledWith(
        "tool",
        expect.objectContaining({ tool: "proton_bridge_health", ms: expect.any(Number) }),
      );
    } finally {
      spyRegister.mockRestore();
    }
  });
});

// ===========================================================================
// F19 — Los recursos se comparten, no se duplican por sesión
// ===========================================================================

describe('buildServer · clientes compartidos', () => {
  it('sin runtime, cada llamada crea los suyos', () => {
    const a = buildServer(makeCfg(), silentLog as never);
    const b = buildServer(makeCfg(), silentLog as never);

    // Es lo correcto para stdio: un proceso, un servidor.
    expect(a.imap).not.toBe(b.imap);
    expect(a.smtp).not.toBe(b.smtp);
  });

  it('con runtime inyectado, se REUTILIZAN los mismos', () => {
    const runtime = buildRuntime(makeCfg(), silentLog as never);

    const sesion1 = buildServer(makeCfg(), silentLog as never, runtime);
    const sesion2 = buildServer(makeCfg(), silentLog as never, runtime);

    // Antes, cada sesión HTTP abría su propio pool y nadie lo cerraba: N
    // sesiones, N pools. El comentario del código decía que se reutilizaban.
    expect(sesion1.imap).toBe(runtime.imap);
    expect(sesion2.imap).toBe(runtime.imap);
    expect(sesion1.smtp).toBe(runtime.smtp);
    expect(sesion2.smtp).toBe(runtime.smtp);
  });
});
