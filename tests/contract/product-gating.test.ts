/**
 * T-MCP-01 (parcial) — Gating por producto (hallazgo F18).
 *
 * Antes de esta prueba, apagar un producto no apagaba sus herramientas:
 * `PROTON_MAIL_ENABLED=false` dejaba 14 herramientas de correo registradas e
 * invocables, y con todos los productos apagados quedaban 19. El operador no
 * podía deshabilitar nada de verdad.
 *
 * Se mide sobre la superficie REAL (`tools/list` por el transporte HTTP), no
 * contando nombres en el código fuente.
 */
import { describe, it, expect, vi } from "vitest";
import { listContractTools, makeContractCfg } from "./helpers.js";

vi.mock("../../src/imap.js", () => ({
  ImapClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("../../src/smtp.js", () => ({
  SmtpClient: vi.fn().mockImplementation(() => ({})),
  buildReplyOptions: vi.fn(),
  buildForwardOptions: vi.fn(),
}));
vi.mock("../../src/pass.js", () => ({
  PassClient: vi.fn().mockImplementation(() => ({
    getBackendBinary: () => "pass",
  })),
}));
vi.mock("../../src/drive.js", () => ({
  DriveClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("../../src/bridge/bridge-client.js", () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({})),
}));

type Products = ReturnType<typeof makeContractCfg>["products"];

/** Config con los productos indicados apagados; el resto, como en el contrato. */
function withProducts(off: Partial<Record<keyof Products, boolean>>) {
  const base = makeContractCfg().products;
  return {
    ...makeContractCfg(),
    products: {
      ...base,
      mail: { ...base.mail, enabled: off.mail ?? true },
      pass: { ...base.pass, enabled: off.pass ?? true },
      drive: { ...base.drive, enabled: off.drive ?? true },
      calendar: { ...base.calendar, enabled: off.calendar ?? true },
    },
  };
}

const namesOf = (tools: { name: string }[]) => tools.map((t) => t.name);

/** Herramientas que dependen de un producto concreto. */
const MAIL_AGENT_TOOLS = [
  "proton_agent_plan",
  "proton_create_folder",
  "proton_delete_email",
  "proton_flag_email",
  "proton_forward_email",
  "proton_get_attachment",
  "proton_get_email",
  "proton_list_emails",
  "proton_list_folders",
  "proton_mailbox_status",
  "proton_move_email",
  "proton_reply_email",
  "proton_search_emails",
  "proton_send_email",
] as const

const AGENT_TOOLS = "proton_agent_plan";
const PASS_PREFIX = "proton_pass_";
const DRIVE_PREFIX = "proton_drive_";
const CALENDAR_PREFIX = "proton_calendar_";

describe("T-MCP-01 · gating por producto (F18)", () => {
  it("con mail apagado no queda ninguna herramienta de correo ni del agente", async () => {
    const names = namesOf(await listContractTools(withProducts({ mail: false })));

    expect(names).not.toContain(AGENT_TOOLS);
    const surviving = names.filter((n) =>
      (MAIL_AGENT_TOOLS as readonly string[]).includes(n),
    );
    expect(surviving).toEqual([]);
  });

  it("con mail apagado siguen las herramientas transversales", async () => {
    const names = namesOf(await listContractTools(withProducts({ mail: false })));

    expect(names).toContain("proton_suite_status");
    expect(names).toContain("proton_ecosystem_discover");
  });

  it("con pass apagado no queda ninguna herramienta de Pass", async () => {
    const names = namesOf(await listContractTools(withProducts({ pass: false })));
    expect(names.filter((n) => n.startsWith(PASS_PREFIX))).toEqual([]);
  });

  it("con drive apagado no queda ninguna herramienta de Drive", async () => {
    const names = namesOf(await listContractTools(withProducts({ drive: false })));
    expect(names.filter((n) => n.startsWith(DRIVE_PREFIX))).toEqual([]);
  });

  it("con calendar apagado no queda ninguna herramienta de Calendar", async () => {
    const names = namesOf(
      await listContractTools(withProducts({ calendar: false })),
    );
    expect(names.filter((n) => n.startsWith(CALENDAR_PREFIX))).toEqual([]);
  });

  it("con todos los productos apagados solo quedan capacidades transversales", async () => {
    const names = namesOf(
      await listContractTools(
        withProducts({ mail: false, pass: false, drive: false, calendar: false }),
      ),
    );

    expect(names.sort()).toEqual([
      "proton_ecosystem_check_updates",
      "proton_ecosystem_discover",
      "proton_ecosystem_health",
      "proton_ecosystem_install",
      "proton_suite_status",
    ]);
  });

  it("con todo habilitado el inventario del contrato no cambia", async () => {
    const names = namesOf(await listContractTools());
    expect(names).toHaveLength(47);
    expect(names).toContain("proton_list_emails");
    expect(names).toContain(AGENT_TOOLS);
  });
});
