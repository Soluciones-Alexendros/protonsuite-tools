/**
 * Tests for `registerDriveTools` — all 14 tool handlers with response_format
 * branches, error handling, dry-run / real mode, and the early-return guard.
 *
 * Pattern follows tests/server/server.test.ts: mock `registerTool` captures
 * handlers, then we invoke each handler with controlled inputs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../../src/config.js";
import { registerDriveTools } from "../../src/server/drive.js";

// ---------------------------------------------------------------------------
// Mock DriveAuditor + motor de aplicación
// ---------------------------------------------------------------------------

const mockAuditor = {
  scanInventory: vi.fn(),
  findDuplicates: vi.fn(),
  formatReport: vi.fn(),
  buildOrganizePlan: vi.fn(),
  hashFile: vi.fn(),
};

const mockApplyOrganizePlan = vi.fn();

vi.mock("../../src/drive-audit.js", () => ({
  DriveAuditor: vi.fn().mockImplementation(() => mockAuditor),
  applyOrganizePlan: (...args: unknown[]) => mockApplyOrganizePlan(...args),
}));

// ---------------------------------------------------------------------------
// Mock DriveClient
// ---------------------------------------------------------------------------

const mockDriveClient = {
  opts: { cliBin: "/usr/bin/proton-drive" },
  stagingDir: "/tmp/staging",
  execCli: vi.fn(),
  listFiles: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  share: vi.fn(),
  status: vi.fn(),
  moveFiles: vi.fn(),
  copyFiles: vi.fn(),
  mkdir: vi.fn(),
  removeFiles: vi.fn(),
  checkDeps: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLog = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

const capturedTools = new Map<
  string,
  { config: unknown; handler: (...args: never[]) => unknown }
>();

function mockRegister(
  name: string,
  config: unknown,
  handler: (...args: never[]) => unknown,
) {
  capturedTools.set(name, { config, handler });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedTools.clear();

  // Default auditor returns — tests override as needed
  mockAuditor.scanInventory.mockReturnValue({
    totalFiles: 5,
    totalBytes: 10240,
    byExt: { ".md": 2, ".txt": 2, ".jpg": 1 },
    byDir: { "/": 5 },
    files: [
      { name: "a.md", path: "a.md", ext: ".md", size: 100, modified: new Date() },
      { name: "b.txt", path: "b.txt", ext: ".txt", size: 200, modified: new Date() },
    ],
  });
  mockAuditor.findDuplicates.mockReturnValue([
    {
      hash: "abc123",
      size: 100,
      files: [
        { path: "dup1.txt", name: "dup1.txt" },
        { path: "dup2.txt", name: "dup2.txt" },
      ],
    },
  ]);
  mockAuditor.formatReport.mockReturnValue({
    totalExtensions: 3,
    extensions: [".jpg", ".md", ".txt"],
    obsoleteExtensions: [".doc", ".ppt"],
    obsoleteFiles: [{ name: "old.doc", path: "old.doc", ext: ".doc", size: 500 }],
    noExtension: 0,
  });
  mockAuditor.buildOrganizePlan.mockReturnValue({
    suggestions: [
      { action: "move" as const, from: "a.md", to: "docs/a.md", reason: "Move .md to docs/" },
    ],
  });

  mockDriveClient.status.mockResolvedValue({
    ok: true,
    configured: true,
    authenticated: true,
    stagingExists: true,
    stagingFiles: 5,
    stagingBytes: 10240,
    cliPath: "/usr/bin/proton-drive",
  });
  mockDriveClient.listFiles.mockResolvedValue({
    ok: true,
    files: [{ name: "report.pdf", size: 2048 }],
    raw: JSON.stringify([{ name: "report.pdf", size: 2048 }]),
  });
  mockDriveClient.download.mockResolvedValue({
    ok: true,
    remotePath: "/remote",
    localPath: "/tmp/staging",
  });
  mockDriveClient.upload.mockResolvedValue({
    ok: true,
    localPath: "/tmp/staging",
    remotePath: "/my-files",
  });
  mockDriveClient.share.mockResolvedValue({
    ok: true,
    remotePath: "/shared",
    userEmail: "user@test.com",
  });
  mockDriveClient.moveFiles.mockResolvedValue({ ok: true });
  mockDriveClient.copyFiles.mockResolvedValue({ ok: true });
  mockDriveClient.mkdir.mockResolvedValue({ ok: true });
  mockDriveClient.removeFiles.mockResolvedValue({ ok: true });
  mockDriveClient.checkDeps.mockReturnValue({ ok: true, version: "0.8.0" });
});

function makeCfg(enabled = true): Config {
  return {
    products: {
      mail: { enabled: false, bridge: null as never },
      pass: { enabled: false, storeDir: "/tmp" },
      calendar: { enabled: false },
      drive: {
        enabled,
        cliBin: "/usr/bin/proton-drive",
        stagingDir: "/tmp/staging",
        obsoleteExtensions: [".doc", ".ppt"],
      },
    },
    transport: { kind: "stdio" as const, httpHost: "127.0.0.1", httpPort: 8787, allowedOrigins: [] },
    alerts: { enabled: false, logDir: "logs", minSeverity: "warning" },
    agent: { dryRun: true, maxInspectEmails: 10, minConfidence: 0.6 },
    logLevel: "error",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerDriveTools", () => {
  it("registers nothing when drive is disabled", () => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(false),
      log: silentLog,
      driveClient: mockDriveClient,
    });
    expect(capturedTools.size).toBe(0);
  });

  it("registers nothing when driveClient is undefined", () => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: undefined,
    });
    expect(capturedTools.size).toBe(0);
  });

  it("registers all 14 tools when drive is enabled", () => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
    expect(capturedTools.size).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Individual tool handlers
// ---------------------------------------------------------------------------

describe("proton_drive_audit", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("returns markdown report by default", async () => {
    const tool = capturedTools.get("proton_drive_audit")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Drive Audit");
    expect(text).toContain("5 files");
    expect(text).toContain("Duplicates");
    expect(text).toContain("Obsolete formats");
    expect((result as any).structuredContent).toBeDefined();
  });

  it("returns JSON report with response_format=json", async () => {
    const tool = capturedTools.get("proton_drive_audit")!;
    const result = await (tool.handler)({
      response_format: "json",
    } as never);

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.totalFiles).toBe(5);
    expect(parsed.duplicates).toHaveLength(1);
    expect(parsed.obsoleteFiles).toHaveLength(1);
  });

  it("uses custom staging_dir when provided", async () => {
    const tool = capturedTools.get("proton_drive_audit")!;
    await (tool.handler)({
      staging_dir: "/custom/path",
    } as never);

    expect(mockAuditor.scanInventory).toHaveBeenCalledWith("/custom/path");
  });

  it("returns error when auditor throws", async () => {
    mockAuditor.scanInventory.mockImplementation(() => {
      throw new Error("permission denied");
    });

    const tool = capturedTools.get("proton_drive_audit")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("permission denied");
  });

  it("omits duplicates and obsolete sections when empty arrays", async () => {
    mockAuditor.findDuplicates.mockReturnValue([]);
    mockAuditor.formatReport.mockReturnValue({
      totalExtensions: 2,
      extensions: [".md", ".txt"],
      obsoleteExtensions: [],
      obsoleteFiles: [],
      noExtension: 0,
    });

    const tool = capturedTools.get("proton_drive_audit")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).not.toContain("Duplicates");
    expect(text).not.toContain("Obsolete formats");
    expect(text).toContain("By extension");
  });

  it("muestra (none) para archivos sin extensión en el report markdown", async () => {
    mockAuditor.scanInventory.mockReturnValue({
      totalFiles: 3,
      totalBytes: 300,
      byExt: { "": 1, ".md": 2 },
      byDir: { "/": 3 },
      files: [
        { name: "README", path: "README", ext: "", size: 100, modified: new Date() },
        { name: "a.md", path: "a.md", ext: ".md", size: 200, modified: new Date() },
      ],
    });

    const tool = capturedTools.get("proton_drive_audit")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("`(none)`: 1");
  });
});

describe("proton_drive_status", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("returns markdown status by default", async () => {
    const tool = capturedTools.get("proton_drive_status")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Drive Status");
    expect(text).toContain("**Authenticated:** yes");
    expect(text).toContain("**Staging exists:** yes");
    expect(text).toContain("**Staging files:** 5");
  });

  it("returns JSON status with response_format=json", async () => {
    const tool = capturedTools.get("proton_drive_status")!;
    const result = await (tool.handler)({
      response_format: "json",
    } as never);

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.authenticated).toBe(true);
    expect(parsed.ok).toBe(true);
  });

  it("returns error when status throws", async () => {
    mockDriveClient.status.mockRejectedValue(new Error("bridge offline"));

    const tool = capturedTools.get("proton_drive_status")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("bridge offline");
  });

  it("handles authenticated=false in markdown output", async () => {
    mockDriveClient.status.mockResolvedValue({
      ok: true,
      configured: true,
      authenticated: false,
      stagingExists: true,
      stagingFiles: 5,
      cliPath: "/usr/bin/proton-drive",
    });

    const tool = capturedTools.get("proton_drive_status")!;
    const result = await (tool.handler as (args: never) => unknown)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("**Authenticated:** no");
    expect(text).toContain("**Staging exists:** yes");
  });

  it("handles undefined optional fields in markdown", async () => {
    mockDriveClient.status.mockResolvedValue({
      ok: true,
      configured: true,
      authenticated: undefined,
      stagingExists: false,
      cliPath: "/usr/bin/proton-drive",
    });

    const tool = capturedTools.get("proton_drive_status")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("**Authenticated:** n/a");
    expect(text).toContain("**Staging exists:** no");
  });

  it("incluye línea de error en markdown cuando st.error está definido", async () => {
    mockDriveClient.status.mockResolvedValue({
      ok: true,
      configured: true,
      authenticated: true,
      stagingExists: true,
      cliPath: "/usr/bin/proton-drive",
      error: "Bridge not responding",
    });

    const tool = capturedTools.get("proton_drive_status")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("**Error:** Bridge not responding");
  });
});

describe("proton_drive_organize", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("returns dry-run plan by default", async () => {
    const tool = capturedTools.get("proton_drive_organize")!;
    const result = await (tool.handler)({
      dry_run: true,
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Organize plan (dry-run)");
    expect(text).toContain("a.md");
    expect(text).toContain("docs/a.md");
    expect((result as any).structuredContent.dryRun).toBe(true);
  });

  it("aplica con el motor compartido cuando dry_run=false", async () => {
    mockApplyOrganizePlan.mockReturnValue({
      moved: 1,
      skipped: 0,
      failed: 0,
      results: [{ from: "a.md", to: "docs/a.md", status: "moved" }],
    });

    const tool = capturedTools.get("proton_drive_organize")!;
    const result = await (tool.handler)({
      dry_run: false,
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Moved 1, skipped 0, failed 0");
    expect(mockApplyOrganizePlan).toHaveBeenCalledWith(
      "/tmp/staging",
      expect.anything(),
      silentLog,
    );
    expect((result as any).structuredContent.dryRun).toBe(false);
  });

  it("informa de fallos sin inventar éxito (F02)", async () => {
    mockApplyOrganizePlan.mockReturnValue({
      moved: 0,
      skipped: 0,
      failed: 1,
      results: [
        { from: "a.md", to: "docs/a.md", status: "failed", reason: "destination-exists" },
      ],
    });

    const tool = capturedTools.get("proton_drive_organize")!;
    const result = await (tool.handler)({ dry_run: false } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Moved 0, skipped 0, failed 1");
    expect(text).not.toContain("Moved 1");
  });

  it("propaga la estrategia al constructor del plan", async () => {
    const tool = capturedTools.get("proton_drive_organize")!;
    await (tool.handler)({ dry_run: true, strategy: "rename" } as never);

    expect(mockAuditor.buildOrganizePlan).toHaveBeenCalledWith("/tmp/staging", {
      strategy: "rename",
    });
  });

  it("uses custom staging_dir", async () => {
    const tool = capturedTools.get("proton_drive_organize")!;
    await (tool.handler)({
      staging_dir: "/custom",
      strategy: "reject",
    } as never);

    expect(mockAuditor.buildOrganizePlan).toHaveBeenCalledWith("/custom", {
      strategy: "reject",
    });
  });

  it("rechaza por defecto cuando el handler se invoca sin strategy", async () => {
    const tool = capturedTools.get("proton_drive_organize")!;
    await (tool.handler)({ dry_run: true } as never);

    // El handler se invoca directo (sin Zod), así que el default del schema no
    // se aplica aquí; queda documentado que Zod es quien garantiza 'reject'.
    expect(mockAuditor.buildOrganizePlan).toHaveBeenCalledWith("/tmp/staging", {
      strategy: undefined,
    });
  });

  it("returns error when organize throws", async () => {
    mockAuditor.buildOrganizePlan.mockImplementation(() => {
      throw new Error("disk error");
    });

    const tool = capturedTools.get("proton_drive_organize")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("disk error");
  });
});

describe("proton_drive_format_report", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("returns markdown format report by default", async () => {
    const tool = capturedTools.get("proton_drive_format_report")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Drive Format Report");
    expect(text).toContain("**Total extensions:** 3");
    expect(text).toContain("**Obsolete files:** 1");
    expect(text).toContain("old.doc");
  });

  it("returns JSON format report with response_format=json", async () => {
    const tool = capturedTools.get("proton_drive_format_report")!;
    const result = await (tool.handler)({
      response_format: "json",
    } as never);

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.totalExtensions).toBe(3);
    expect(parsed.obsoleteFiles).toHaveLength(1);
  });

  it("uses custom staging_dir", async () => {
    const tool = capturedTools.get("proton_drive_format_report")!;
    await (tool.handler)({
      staging_dir: "/other",
    } as never);

    expect(mockAuditor.formatReport).toHaveBeenCalledWith("/other");
  });

  it("returns error when format throws", async () => {
    mockAuditor.formatReport.mockImplementation(() => {
      throw new Error("corrupt inventory");
    });

    const tool = capturedTools.get("proton_drive_format_report")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("corrupt inventory");
  });

  it("omite sección Obsolete files cuando obsoleteFiles vacío (línea 282 — falsy branch)", async () => {
    mockAuditor.formatReport.mockReturnValue({
      totalExtensions: 2,
      extensions: [".md", ".txt"],
      obsoleteExtensions: [],
      obsoleteFiles: [], // empty → hits `length > 0 ? [...] : []` false branch
      noExtension: 0,
    });

    const tool = capturedTools.get("proton_drive_format_report")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("## Extensions");
    expect(text).not.toContain("## Obsolete files");
    expect(text).toContain("**Obsolete files:** 0");
  });
});

describe("proton_drive_list_files", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("returns markdown file list by default", async () => {
    const tool = capturedTools.get("proton_drive_list_files")!;
    const result = await (tool.handler)({
      remote_path: "/my-files",
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Drive `/my-files`");
    expect(text).toContain("**Entries:** 1");
    expect(text).toContain("report.pdf");
  });

  it("returns JSON file list with response_format=json", async () => {
    const tool = capturedTools.get("proton_drive_list_files")!;
    const result = await (tool.handler)({
      response_format: "json",
    } as never);

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("report.pdf");
  });

  it("uses custom remote_path", async () => {
    const tool = capturedTools.get("proton_drive_list_files")!;
    await (tool.handler)({
      remote_path: "/Documents",
    } as never);

    expect(mockDriveClient.listFiles).toHaveBeenCalledWith("/Documents");
  });

  it("returns error when listFiles returns !ok", async () => {
    mockDriveClient.listFiles.mockResolvedValue({
      ok: false,
      files: [],
      raw: "",
      error: "remote not found",
    });

    const tool = capturedTools.get("proton_drive_list_files")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("List failed");
  });

  it("returns error when listFiles throws", async () => {
    mockDriveClient.listFiles.mockRejectedValue(new Error("timeout"));

    const tool = capturedTools.get("proton_drive_list_files")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("timeout");
  });

  it("usa path cuando está definido y omite size ausente", async () => {
    mockDriveClient.listFiles.mockResolvedValue({
      ok: true,
      files: [
        { path: "/docs/report.pdf", name: "report.pdf", size: 2048 },
        { path: "/readme.txt", name: "readme.txt" },
      ],
    });

    const tool = capturedTools.get("proton_drive_list_files")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("/docs/report.pdf");
    expect(text).toContain("(2048 bytes)");
    expect(text).toContain("/readme.txt");
  });

  it("muestra (unknown) cuando file no tiene path ni name", async () => {
    mockDriveClient.listFiles.mockResolvedValue({
      ok: true,
      files: [
        { name: "report.pdf", size: 2048 },
        { size: 512 },  // sin path ni name → f.name ?? '(unknown)' = '(unknown)'
      ],
    });

    const tool = capturedTools.get("proton_drive_list_files")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("report.pdf");
    expect(text).toContain("(unknown)");
    expect(text).toContain("(512 bytes)");
  });
});

describe("proton_drive_download", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("downloads to staging dir by default", async () => {
    const tool = capturedTools.get("proton_drive_download")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Downloaded");
  });

  it("uses custom local_path when provided", async () => {
    const tool = capturedTools.get("proton_drive_download")!;
    await (tool.handler)({
      local_path: "/custom",
    } as never);

    expect(mockDriveClient.download).toHaveBeenCalledWith(undefined, "/custom");
  });

  it("returns error when download fails", async () => {
    mockDriveClient.download.mockResolvedValue({
      ok: false,
      remotePath: "/remote",
      localPath: "/tmp",
      error: "disk full",
    });

    const tool = capturedTools.get("proton_drive_download")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("Download failed");
  });

  it("returns error when download throws", async () => {
    mockDriveClient.download.mockRejectedValue(new Error("network error"));

    const tool = capturedTools.get("proton_drive_download")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("network error");
  });
});

describe("proton_drive_upload", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("uploads staging dir to /my-files by default", async () => {
    const tool = capturedTools.get("proton_drive_upload")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Uploaded");
    expect(text).toContain("/my-files");
  });

  it("uses custom paths when provided", async () => {
    const tool = capturedTools.get("proton_drive_upload")!;
    await (tool.handler)({
      local_path: "/custom",
      remote_path: "/other",
    } as never);

    expect(mockDriveClient.upload).toHaveBeenCalledWith("/custom", "/other");
  });

  it("returns error when upload fails", async () => {
    mockDriveClient.upload.mockResolvedValue({
      ok: false,
      localPath: "/tmp",
      remotePath: "/my-files",
      error: "quota exceeded",
    });

    const tool = capturedTools.get("proton_drive_upload")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("Upload failed");
  });

  it("returns error when upload throws", async () => {
    mockDriveClient.upload.mockRejectedValue(new Error("auth expired"));

    const tool = capturedTools.get("proton_drive_upload")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("auth expired");
  });
});

describe("proton_drive_share", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("shares a path and returns confirmation", async () => {
    const tool = capturedTools.get("proton_drive_share")!;
    const result = await (tool.handler)({
      remote_path: "/shared",
      user_email: "user@test.com",
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Invited");
    expect(text).toContain("user@test.com");
  });

  it("returns error when share fails", async () => {
    mockDriveClient.share.mockResolvedValue({
      ok: false,
      remotePath: "/shared",
      userEmail: "user@test.com",
      error: "user not found",
    });

    const tool = capturedTools.get("proton_drive_share")!;
    const result = await (tool.handler)({
      remote_path: "/shared",
      user_email: "user@test.com",
    } as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("Share failed");
  });

  it("returns error when share throws", async () => {
    mockDriveClient.share.mockRejectedValue(new Error("API error"));

    const tool = capturedTools.get("proton_drive_share")!;
    const result = await (tool.handler)({
      remote_path: "/shared",
      user_email: "user@test.com",
    } as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("API error");
  });
});

describe("proton_drive_move", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("moves a path and returns confirmation", async () => {
    const tool = capturedTools.get("proton_drive_move")!;
    const result = await (tool.handler)({
      from: "/a",
      to: "/b",
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Moved /a → /b");
  });

  it("returns error when move fails", async () => {
    mockDriveClient.moveFiles.mockResolvedValue({ ok: false, error: "no such file" });

    const tool = capturedTools.get("proton_drive_move")!;
    const result = await (tool.handler)({
      from: "/a",
      to: "/b",
    } as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("no such file");
  });
});

describe("proton_drive_copy", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("copies a path and returns confirmation", async () => {
    const tool = capturedTools.get("proton_drive_copy")!;
    const result = await (tool.handler)({
      from: "/s",
      to: "/d",
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Copied /s → /d");
  });

  it("returns error when copy fails", async () => {
    mockDriveClient.copyFiles.mockResolvedValue({ ok: false, error: "path conflict" });

    const tool = capturedTools.get("proton_drive_copy")!;
    const result = await (tool.handler)({
      from: "/s",
      to: "/d",
    } as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("path conflict");
  });
});

describe("proton_drive_create_folder", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("creates a folder and returns confirmation", async () => {
    const tool = capturedTools.get("proton_drive_create_folder")!;
    const result = await (tool.handler)({
      remote_path: "/new",
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Created folder: /new");
  });

  it("returns error when mkdir fails", async () => {
    mockDriveClient.mkdir.mockResolvedValue({ ok: false, error: "already exists" });

    const tool = capturedTools.get("proton_drive_create_folder")!;
    const result = await (tool.handler)({
      remote_path: "/new",
    } as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("already exists");
  });
});

describe("proton_drive_remove", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("removes a path and returns confirmation", async () => {
    const tool = capturedTools.get("proton_drive_remove")!;
    const result = await (tool.handler)({
      remote_path: "/old",
    } as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Removed: /old");
  });

  it("returns error when remove fails", async () => {
    mockDriveClient.removeFiles.mockResolvedValue({ ok: false, error: "permission denied" });

    const tool = capturedTools.get("proton_drive_remove")!;
    const result = await (tool.handler)({
      remote_path: "/old",
    } as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("permission denied");
  });
});

describe("proton_drive_auth_status", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("returns markdown auth status when authenticated", async () => {
    mockDriveClient.checkDeps.mockReturnValue({ ok: true, version: "0.8.0" });
    mockDriveClient.status.mockResolvedValue({
      ok: true,
      configured: true,
      authenticated: true,
      stagingExists: true,
      cliPath: "/usr/bin/proton-drive",
    });

    const tool = capturedTools.get("proton_drive_auth_status")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Drive Auth Status");
    expect(text).toContain("**CLI installed:** yes");
    expect(text).toContain("**CLI version:** 0.8.0");
    expect(text).toContain("**Authenticated:** yes");
  });

  it("returns markdown when not authenticated", async () => {
    mockDriveClient.checkDeps.mockReturnValue({ ok: true, version: "0.8.0" });
    mockDriveClient.status.mockResolvedValue({
      ok: true,
      configured: true,
      authenticated: false,
      stagingExists: false,
      cliPath: "/usr/bin/proton-drive",
    });

    const tool = capturedTools.get("proton_drive_auth_status")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("**Authenticated:** no");
  });

  it("returns markdown when CLI is not installed", async () => {
    mockDriveClient.checkDeps.mockReturnValue({
      ok: false,
      error: "proton-drive not found",
    });
    mockDriveClient.status.mockResolvedValue({
      ok: false,
      configured: true,
      authenticated: false,
      stagingExists: false,
      cliPath: "/usr/bin/proton-drive",
    });

    const tool = capturedTools.get("proton_drive_auth_status")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("**CLI installed:** no");
    expect(text).toContain("**CLI error:** proton-drive not found");
  });

  it("returns JSON auth status", async () => {
    mockDriveClient.checkDeps.mockReturnValue({ ok: true, version: "0.8.0" });

    const tool = capturedTools.get("proton_drive_auth_status")!;
    const result = await (tool.handler)({
      response_format: "json",
    } as never);

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.cliInstalled).toBe(true);
    expect(parsed.authenticated).toBe(true);
  });

  it("returns error when status throws", async () => {
    mockDriveClient.status.mockRejectedValue(new Error("bridge unreachable"));

    const tool = capturedTools.get("proton_drive_auth_status")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("bridge unreachable");
  });
});

describe("proton_drive_auth_login", () => {
  beforeEach(() => {
    registerDriveTools({ registerTool: mockRegister } as never, {
      cfg: makeCfg(true),
      log: silentLog,
      driveClient: mockDriveClient,
    });
  });

  it("returns already authenticated message when status says authenticated", async () => {
    mockDriveClient.status.mockResolvedValue({
      ok: true,
      configured: true,
      authenticated: true,
      stagingExists: true,
      cliPath: "/usr/bin/proton-drive",
    });

    const tool = capturedTools.get("proton_drive_auth_login")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Already authenticated");
    expect((result as any).structuredContent.alreadyAuthenticated).toBe(true);
  });

  it("returns login instructions when not authenticated", async () => {
    mockDriveClient.status.mockResolvedValue({
      ok: false,
      configured: true,
      authenticated: false,
      stagingExists: false,
      cliPath: "/usr/bin/proton-drive",
    });
    mockDriveClient.execCli.mockRejectedValue(new Error("interactive prompt not supported"));

    const tool = capturedTools.get("proton_drive_auth_login")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Drive Authentication");
    expect(text).toContain("proton-drive auth login");
    expect(text).toContain("terminal");
    expect((result as any).structuredContent.requiresInteractiveLogin).toBe(true);
  });

  it("skips auth check when force=true and returns instructions", async () => {
    mockDriveClient.execCli.mockRejectedValue(new Error("interactive prompt not supported"));

    const tool = capturedTools.get("proton_drive_auth_login")!;
    const result = await (tool.handler)({
      force: true,
    } as never);

    // status() should NOT have been called
    expect(mockDriveClient.status).not.toHaveBeenCalled();
    const text = (result as any).content[0].text;
    expect(text).toContain("Proton Drive Authentication");
  });

  it("returns success message when execCli auth login succeeds", async () => {
    mockDriveClient.status.mockResolvedValue({
      ok: false,
      configured: true,
      authenticated: false,
      stagingExists: false,
      cliPath: "/usr/bin/proton-drive",
    });
    mockDriveClient.execCli.mockResolvedValue({ stdout: "ok", stderr: "" });

    const tool = capturedTools.get("proton_drive_auth_login")!;
    const result = await (tool.handler)({} as never);

    const text = (result as any).content[0].text;
    expect(text).toContain("Authentication command completed");
    expect((result as any).structuredContent.loginCompleted).toBe(true);
  });

  it("returns error when status throws", async () => {
    mockDriveClient.status.mockRejectedValue(new Error("bridge not responding"));

    const tool = capturedTools.get("proton_drive_auth_login")!;
    const result = await (tool.handler)({} as never);

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("bridge not responding");
  });
});
