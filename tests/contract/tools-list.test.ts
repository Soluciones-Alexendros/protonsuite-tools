/**
 * Contract test: tool list stability (client-facing `tools/list`).
 *
 * A través del transport HTTP real, verifica que la superficie de herramientas
 * expuesta a los clientes MCP es estable:
 *  - exactamente 47 tools registradas por defecto (50 con Calendar experimental).
 *  - el conjunto de nombres coincide con el golden set (documentado en run1.md).
 *  - cada tool expone title, description, inputSchema y annotations.
 *  - cada tool declara `openWorldHint` (mínimo exigido por la convención del
 *    agente: ver server.ts §"annotations").
 *
 * No requiere GreenMail: los adapters están mockeados; el test solo LISTA.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { listContractTools, makeContractCfg, type ClientTool } from "./helpers.js";

// Mocks de adapters — vitest los hoistea al inicio del módulo (antes de los
// imports superiores), por lo que buildContractServer siempre ve versiones mockeadas.
vi.mock("../../src/imap.js", () => ({
  ImapClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("../../src/smtp.js", () => ({
  SmtpClient: vi.fn().mockImplementation(() => ({})),
  buildReplyOptions: vi.fn(),
  buildForwardOptions: vi.fn(),
}));
vi.mock("../../src/pass.js", () => ({
  createPassClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("../../src/drive.js", () => ({
  DriveClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("../../src/bridge/bridge-client.js", () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({})),
}));

// Golden set de los 47 tools por defecto (Calendar oculto detrás de
// PROTON_CALENDAR_EXPERIMENTAL=1). Véase package.json: "50 tools" total.
const EXPECTED_TOOL_NAMES = [
  "proton_agent_plan",
  "proton_bridge_accounts",
  "proton_bridge_health",
  "proton_bridge_info",
  "proton_bridge_login",
  "proton_bridge_logout",
  "proton_bridge_status",
  "proton_create_folder",
  "proton_delete_email",
  "proton_drive_audit",
  "proton_drive_auth_login",
  "proton_drive_auth_status",
  "proton_drive_copy",
  "proton_drive_create_folder",
  "proton_drive_download",
  "proton_drive_format_report",
  "proton_drive_list_files",
  "proton_drive_move",
  "proton_drive_organize",
  "proton_drive_remove",
  "proton_drive_share",
  "proton_drive_status",
  "proton_drive_upload",
  "proton_ecosystem_check_updates",
  "proton_ecosystem_discover",
  "proton_ecosystem_health",
  "proton_ecosystem_install",
  "proton_flag_email",
  "proton_forward_email",
  "proton_get_attachment",
  "proton_get_email",
  "proton_list_emails",
  "proton_list_folders",
  "proton_mailbox_status",
  "proton_move_email",
  "proton_pass_copy",
  "proton_pass_generate",
  "proton_pass_get",
  "proton_pass_health",
  "proton_pass_insert",
  "proton_pass_list",
  "proton_pass_move",
  "proton_pass_remove",
  "proton_reply_email",
  "proton_search_emails",
  "proton_send_email",
  "proton_suite_status",
] as const;

describe("Contract: MCP tool list (client-facing tools/list)", () => {
  let tools: ClientTool[];

  beforeAll(async () => {
    tools = await listContractTools();
  });

  it("exposes exactly 47 tools by default", () => {
    expect(tools).toHaveLength(47);
  });

  it("matches the golden tool-name set", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("every tool has title, description and a non-null inputSchema", () => {
    for (const t of tools) {
      expect(t.title, `${t.name} missing title`).toBeTruthy();
      expect(t.description, `${t.name} missing description`).toBeTruthy();
      expect(t.inputSchema, `${t.name} missing inputSchema`).toBeTypeOf("object");
    }
  });

  it("every tool declares JSON-schema inputSchema to clients", () => {
    for (const t of tools) {
      const schema = t.inputSchema as { type?: unknown; $schema?: unknown; properties?: unknown } | undefined;
      expect(schema && typeof schema === "object", `${t.name} inputSchema must be an object`).toBe(true);
      expect(schema?.type, `${t.name} schema type`).toBe("object");
      // `$schema` (draft-07) está presente en schemas reales; el fallback
      // EMPTY_OBJECT_JSON_SCHEMA del SDK ({type:"object",properties:{}}) para
      // tools sin args no incluye `$schema`. Ambas formas son válidas.
      if (schema?.$schema !== undefined) {
        expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      }
    }
  });

  it("every tool declares openWorldHint annotation (agent convention)", () => {
    for (const t of tools) {
      const ann = (t.annotations ?? {});
      expect(
        "openWorldHint" in ann && typeof ann.openWorldHint === "boolean",
        `${t.name} missing openWorldHint`,
      ).toBe(true);
    }
  });

  it("no duplicate tool names", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Contract: Calendar experimental tools", () => {
  it("exposes 50 tools when PROTON_CALENDAR_EXPERIMENTAL is enabled", async () => {
    const experimentalTools = await listContractTools({
      products: {
        ...makeContractCfg().products,
        calendar: { enabled: true, experimental: true },
      },
    });
    expect(experimentalTools).toHaveLength(50);
    const names = experimentalTools.map((t) => t.name);
    expect(names).toContain("proton_calendar_list_events");
    expect(names).toContain("proton_calendar_create_event");
    expect(names).toContain("proton_calendar_list_calendars");
  });
});
