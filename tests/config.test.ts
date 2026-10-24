import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, createLogger, resolveBridgeConfig, mailBridge, isDryRun } from "../src/config.js";

// ===========================================================================
// loadConfig — env-based config loading
// ===========================================================================

describe("loadConfig · env validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (
        k.startsWith("PROTON_") ||
        k.startsWith("MCP_") ||
        k.startsWith("LOG_") ||
        k.startsWith("AGENT_") ||
        k.startsWith("ALERT_") ||
        k.startsWith("DRIVE_") ||
        k.startsWith("PASS_") ||
        k.startsWith("CALENDAR_")
      )
        delete process.env[k];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -- Bridge validation ------------------------------------------------

  it("throws with clear error when PROTON_BRIDGE_USER is missing", () => {
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    expect(() => loadConfig()).toThrow(/PROTON_BRIDGE_USER/);
  });

  it("throws when PROTON_MAIL_FROM is not a valid email", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "not-an-email";
    expect(() => loadConfig()).toThrow();
  });

  it("defaults PROTON_MAIL_FROM to PROTON_BRIDGE_USER when unset", () => {
    process.env.PROTON_BRIDGE_USER = "alice@proton.me";
    process.env.PROTON_BRIDGE_PASS = "x";
    const cfg = loadConfig();
    expect(cfg.products.mail.bridge.from).toBe("alice@proton.me");
  });

  it("parses tlsInsecure=false correctly", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.PROTON_BRIDGE_TLS_INSECURE = "false";
    const cfg = loadConfig();
    expect(cfg.products.mail.bridge.tlsInsecure).toBe(false);
  });

  it("parses MCP_ALLOWED_ORIGINS CSV into array", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.MCP_ALLOWED_ORIGINS = "https://agent.example, https://dashboard.example";
    const cfg = loadConfig();
    expect(cfg.transport.allowedOrigins).toEqual([
      "https://agent.example",
      "https://dashboard.example",
    ]);
  });

  it("defaults to stdio transport when MCP_TRANSPORT unset", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    const cfg = loadConfig();
    expect(cfg.transport.kind).toBe("stdio");
  });

  it("defaults smtpSecurity to starttls and honors override", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    expect(loadConfig().products.mail.bridge.smtpSecurity).toBe("starttls");
    process.env.PROTON_BRIDGE_SMTP_SECURITY = "implicit";
    expect(loadConfig().products.mail.bridge.smtpSecurity).toBe("implicit");
  });

  it("defaults imapSecurity to starttls and honors override", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    expect(loadConfig().products.mail.bridge.imapSecurity).toBe("starttls");
    process.env.PROTON_BRIDGE_IMAP_SECURITY = "plain";
    expect(loadConfig().products.mail.bridge.imapSecurity).toBe("plain");
  });

  it("reads custom bridge host and ports from env", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.PROTON_BRIDGE_HOST = "bridge";
    process.env.PROTON_BRIDGE_IMAP_PORT = "1143";
    process.env.PROTON_BRIDGE_SMTP_PORT = "1025";
    const cfg = loadConfig();
    expect(cfg.products.mail.bridge.host).toBe("bridge");
    expect(cfg.products.mail.bridge.imapPort).toBe(1143);
    expect(cfg.products.mail.bridge.smtpPort).toBe(1025);
  });

  it("allows PROTON_BRIDGE_PASS_PATH without PROTON_BRIDGE_PASS", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.PROTON_BRIDGE_PASS_PATH = "proton/bridge/password";
    const cfg = loadConfig();
    expect(cfg.products.mail.bridge.pass).toBe("");
    expect(cfg.products.mail.bridge.passPath).toBe("proton/bridge/password");
  });

  it("allows both PROTON_BRIDGE_PASS and PROTON_BRIDGE_PASS_PATH", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "legacy-password";
    process.env.PROTON_BRIDGE_PASS_PATH = "proton/bridge/password";
    const cfg = loadConfig();
    expect(cfg.products.mail.bridge.pass).toBe("legacy-password");
    expect(cfg.products.mail.bridge.passPath).toBe("proton/bridge/password");
  });

  it("throws when neither PROTON_BRIDGE_PASS nor PROTON_BRIDGE_PASS_PATH is set", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    expect(() => loadConfig()).toThrow(/PROTON_BRIDGE_PASS or PROTON_BRIDGE_PASS_PATH/);
  });

  // -- Transport defaults ------------------------------------------------

  it("transport defaults when MCP_ envs are unset", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    const cfg = loadConfig();
    expect(cfg.transport.httpHost).toBe("127.0.0.1");
    expect(cfg.transport.httpPort).toBe(8787);
    expect(cfg.transport.authToken).toBeUndefined();
    expect(cfg.transport.allowedOrigins).toEqual([]);
  });

  it("reads http transport from env", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.MCP_TRANSPORT = "http";
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    process.env.MCP_HTTP_PORT = "9090";
    process.env.MCP_AUTH_TOKEN = "my-secret";
    const cfg = loadConfig();
    expect(cfg.transport.kind).toBe("http");
    expect(cfg.transport.httpHost).toBe("0.0.0.0");
    expect(cfg.transport.httpPort).toBe(9090);
    expect(cfg.transport.authToken).toBe("my-secret");
  });

  // -- Alert config -------------------------------------------------------

  it("alert config defaults", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    const cfg = loadConfig();
    expect(cfg.alerts.enabled).toBe(true);
    expect(cfg.alerts.minSeverity).toBe("warning");
    expect(cfg.alerts.logDir).toBe("logs");
    expect(cfg.alerts.webhookUrl).toBeUndefined();
  });

  it("alert config with overrides", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.ALERTS_ENABLED = "false";
    process.env.ALERT_MIN_SEVERITY = "info";
    process.env.ALERT_LOG_DIR = "/var/log/proton";
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/alert";
    const cfg = loadConfig();
    expect(cfg.alerts.enabled).toBe(false);
    expect(cfg.alerts.minSeverity).toBe("info");
    expect(cfg.alerts.logDir).toBe("/var/log/proton");
    expect(cfg.alerts.webhookUrl).toBe("https://hooks.example.com/alert");
  });

  // -- Agent config -------------------------------------------------------

  it("agent config defaults", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    const cfg = loadConfig();
    expect(cfg.agent.dryRun).toBe(true);
    expect(cfg.agent.maxInspectEmails).toBe(1000);
    expect(cfg.agent.minConfidence).toBe(0.6);
  });

  it("agent config with overrides", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.AGENT_DRY_RUN = "false";
    process.env.AGENT_MAX_INSPECT_EMAILS = "50";
    process.env.AGENT_MIN_CONFIDENCE = "0.85";
    const cfg = loadConfig();
    expect(cfg.agent.dryRun).toBe(false);
    expect(cfg.agent.maxInspectEmails).toBe(50);
    expect(cfg.agent.minConfidence).toBe(0.85);
  });

  // -- Log level ----------------------------------------------------------

  it("logLevel defaults to info", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    expect(loadConfig().logLevel).toBe("info");
  });

  it("logLevel reads from env", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.LOG_LEVEL = "debug";
    expect(loadConfig().logLevel).toBe("debug");
  });

  // -- Product toggles ----------------------------------------------------

  it("mail can be disabled", () => {
    process.env.PROTON_MAIL_ENABLED = "false";
    process.env.PROTON_BRIDGE_USER = "x@x.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "x@x.com";
    const cfg = loadConfig();
    expect(cfg.products.mail.enabled).toBe(false);
  });

  it("drive can be enabled with defaults", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.DRIVE_ENABLED = "true";
    const cfg = loadConfig();
    expect(cfg.products.drive.enabled).toBe(true);
    expect(cfg.products.drive.cliBin).toBe("proton-drive");
    expect(cfg.products.drive.stagingDir).toBe("~/.proton-drive/staging");
  });

  it("drive can be explicitly disabled", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.DRIVE_ENABLED = "false";
    const cfg = loadConfig();
    expect(cfg.products.drive.enabled).toBe(false);
  });

  it("pass can be enabled with defaults", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.PROTON_PASS_ENABLED = "true";
    const cfg = loadConfig();
    expect(cfg.products.pass.enabled).toBe(true);
    expect(cfg.products.pass.storeDir).toBe("~/.password-store");
    expect(cfg.products.pass.backend).toBe("pass");
  });

  it("pass backend gopass usa GOPASS_STORE_DIR", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.PROTON_PASS_ENABLED = "true";
    process.env.PROTON_PASS_BACKEND = "gopass";
    process.env.GOPASS_STORE_DIR = "/tmp/gopass-store";
    const cfg = loadConfig();
    expect(cfg.products.pass.backend).toBe("gopass");
    expect(cfg.products.pass.storeDir).toBe("/tmp/gopass-store");
  });

  it("alerts ntfy se activa con ALERT_NTFY_TOPIC", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.ALERT_NTFY_TOPIC = "protonsuite-alerts";
    process.env.ALERT_NTFY_URL = "https://ntfy.example";
    process.env.ALERT_NTFY_TOKEN = "tk_test";
    const cfg = loadConfig();
    expect(cfg.alerts.ntfy?.topic).toBe("protonsuite-alerts");
    expect(cfg.alerts.ntfy?.url).toBe("https://ntfy.example");
    expect(cfg.alerts.ntfy?.token).toBe("tk_test");
  });

  it("alerts ntfy sin token usa URL por defecto", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.ALERT_NTFY_TOPIC = "  topic-only  ";
    const cfg = loadConfig();
    expect(cfg.alerts.ntfy?.topic).toBe("topic-only");
    expect(cfg.alerts.ntfy?.url).toBe("https://ntfy.sh");
    expect(cfg.alerts.ntfy?.token).toBeUndefined();
  });

  it("calendar can be enabled", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.PROTON_CALENDAR_ENABLED = "true";
    const cfg = loadConfig();
    expect(cfg.products.calendar.enabled).toBe(true);
  });

  it("drive can be disabled explicitly", () => {
    process.env.PROTON_BRIDGE_USER = "a@b.com";
    process.env.PROTON_BRIDGE_PASS = "x";
    process.env.PROTON_MAIL_FROM = "a@b.com";
    process.env.DRIVE_ENABLED = "true";
    process.env.DRIVE_CLI_BIN = "/custom/bin";
    process.env.DRIVE_STAGING_DIR = "/custom/staging";
    process.env.DRIVE_OBSOLETE_EXTENSIONS = ".doc,.ppt";
    const cfg = loadConfig();
    expect(cfg.products.drive.cliBin).toBe("/custom/bin");
    expect(cfg.products.drive.stagingDir).toBe("/custom/staging");
    expect(cfg.products.drive.obsoleteExtensions).toEqual([".doc", ".ppt"]);
  });
});

// ===========================================================================
// createLogger
// ===========================================================================

describe("createLogger", () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrWrite.mockRestore();
  });

  it("writes error at any level", () => {
    const log = createLogger("info");
    log.error("fail");
    expect(stderrWrite).toHaveBeenCalledOnce();
    const output = stderrWrite.mock.calls[0][0] as string;
    expect(output).toContain("ERROR");
    expect(output).toContain("fail");
  });

  it("writes warn at info level", () => {
    const log = createLogger("info");
    log.warn("caution");
    expect(stderrWrite).toHaveBeenCalledOnce();
    const output = stderrWrite.mock.calls[0][0] as string;
    expect(output).toContain("WARN");
    expect(output).toContain("caution");
  });

  it("writes info at info level", () => {
    const log = createLogger("info");
    log.info("hello");
    expect(stderrWrite).toHaveBeenCalledOnce();
  });

  it("does NOT write debug at info level", () => {
    const log = createLogger("info");
    log.debug("verbose");
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("writes debug at debug level", () => {
    const log = createLogger("debug");
    log.debug("verbose");
    expect(stderrWrite).toHaveBeenCalledOnce();
  });

  it("does NOT write info at error level", () => {
    const log = createLogger("error");
    log.info("silent");
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("appends extra JSON when provided", () => {
    const log = createLogger("info");
    log.info("msg", { key: "val" });
    const output = stderrWrite.mock.calls[0][0] as string;
    expect(output).toContain('{"key":"val"}');
  });

  it("appends extra string when provided", () => {
    const log = createLogger("info");
    log.info("msg", "raw string");
    const output = stderrWrite.mock.calls[0][0] as string;
    expect(output).toContain("raw string");
  });

  it("handles circular JSON in safeStringify", () => {
    const log = createLogger("info");
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    // Should not throw
    expect(() => { log.info("msg", circular); }).not.toThrow();
  });

  it("writes error with extra at debug level", () => {
    const log = createLogger("debug");
    log.error("critical", { code: 500 });
    expect(stderrWrite).toHaveBeenCalledOnce();
    const output = stderrWrite.mock.calls[0][0] as string;
    expect(output).toContain("ERROR");
    expect(output).toContain("critical");
    expect(output).toContain("500");
  });

  it("does NOT write warn at error level", () => {
    const log = createLogger("error");
    log.warn("warning");
    expect(stderrWrite).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// resolveBridgeConfig
// ===========================================================================

describe("resolveBridgeConfig", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  it("uses passwordResolver fallback when pass is disabled", async () => {
    const cfg = loadConfigFromEnv({
      PROTON_BRIDGE_USER: "a@b.com",
      PROTON_BRIDGE_PASS: "x",
      PROTON_MAIL_FROM: "a@b.com",
    });
    const resolved = await resolveBridgeConfig(cfg, log);
    expect(typeof resolved.passwordResolver).toBe("function");
  });

  it("returns config with passwordResolver when pass enabled + passPath set", async () => {
    const cfg = loadConfigFromEnv({
      PROTON_BRIDGE_USER: "a@b.com",
      PROTON_BRIDGE_PASS: "x",
      PROTON_MAIL_FROM: "a@b.com",
      PROTON_PASS_ENABLED: "true",
      PROTON_BRIDGE_PASS_PATH: "proton/bridge/secret",
    });
    const resolved = await resolveBridgeConfig(cfg, log);
    expect(typeof resolved.passwordResolver).toBe("function");
    expect(resolved.passPath).toBe("proton/bridge/secret");
  });

  it("returns config with passwordResolver when pass disabled (fallback)", async () => {
    const cfg = loadConfigFromEnv({
      PROTON_BRIDGE_USER: "a@b.com",
      PROTON_BRIDGE_PASS: "my-pass",
      PROTON_MAIL_FROM: "a@b.com",
    });
    const resolved = await resolveBridgeConfig(cfg, log);
    const password = await resolved.passwordResolver();
    expect(password).toBe("my-pass");
  });
});

// ===========================================================================
// mailBridge & isDryRun helpers
// ===========================================================================

describe("mailBridge helper", () => {
  it("returns the bridge config section", () => {
    const cfg = loadConfigFromEnv({
      PROTON_BRIDGE_USER: "u@b.com",
      PROTON_BRIDGE_PASS: "x",
      PROTON_MAIL_FROM: "u@b.com",
    });
    const bridge = mailBridge(cfg);
    expect(bridge.user).toBe("u@b.com");
    expect(bridge.host).toBe("127.0.0.1");
    expect(bridge.imapPort).toBe(1143);
  });
});

describe("isDryRun helper", () => {
  it("returns true by default", () => {
    const cfg = loadConfigFromEnv({
      PROTON_BRIDGE_USER: "u@b.com",
      PROTON_BRIDGE_PASS: "x",
      PROTON_MAIL_FROM: "u@b.com",
    });
    expect(isDryRun(cfg)).toBe(true);
  });

  it("returns false when AGENT_DRY_RUN=false", () => {
    const cfg = loadConfigFromEnv({
      PROTON_BRIDGE_USER: "u@b.com",
      PROTON_BRIDGE_PASS: "x",
      PROTON_MAIL_FROM: "u@b.com",
      AGENT_DRY_RUN: "false",
    });
    expect(isDryRun(cfg)).toBe(false);
  });
});

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Crea una Config desde un objeto de env vars sin tocar process.env real.
 * Útil para tests que no necesitan mutar el entorno global.
 */
function loadConfigFromEnv(env: Record<string, string>): ReturnType<typeof loadConfig> {
  const originalEnv = { ...process.env };
  const keys = [
    "PROTON_", "MCP_", "LOG_", "AGENT_", "ALERT_",
    "DRIVE_", "PASS_", "CALENDAR_", "ALERTS_",
  ];
  for (const k of Object.keys(process.env)) {
    if (keys.some((p) => k.startsWith(p))) delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
  try {
    return loadConfig();
  } finally {
    process.env = { ...originalEnv };
  }
}
