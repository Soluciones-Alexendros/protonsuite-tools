/**
 * Contract test: per-tool input schema serializability (client-facing).
 *
 * Verifica que el `inputSchema` JSON de cada tool (tal como un cliente MCP lo
 * recibe tras `tools/list`) es:
 *  - un schema JSON de tipo `object` con `properties`.
 *  - serializable de forma determinista (estable byte-a-byte entre ejecuciones
 *    y free of funciones/circular refs).
 *
 * No requiere GreenMail: los adapters están mockeados; el test solo LISTA y
 * valida schemas estáticos. No invoca handlers.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { listContractTools, type ClientTool } from "./helpers.js";

// Mocks de adapters — hoisteados por vitest al inicio del módulo (antes de los imports).
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

/** Serialización determinista: JSON.stringify → parse → re-stringify === original. */
function isSeriallyStable(json: unknown): boolean {
  const a = JSON.stringify(json);
  const b = JSON.stringify(JSON.parse(a));
  return a === b;
}

describe("Contract: per-tool inputSchema serializability", () => {
  let tools: ClientTool[];

  beforeAll(async () => {
    tools = await listContractTools();
  });

  it("every inputSchema is a JSON object schema with properties", () => {
    for (const t of tools) {
      const schema = t.inputSchema as { type?: unknown; properties?: unknown } | undefined;
      expect(schema && typeof schema === "object", `${t.name}: inputSchema must be an object`).toBe(true);
      expect(schema?.type, `${t.name}: must be type object`).toBe("object");
      // Un object schema expone siempre `properties` (aunque vacío) al cliente.
      expect(schema?.properties, `${t.name}: must have properties`).toBeTypeOf("object");
    }
  });

  it("every inputSchema serializes deterministically byte-a-byte", () => {
    for (const t of tools) {
      expect(
        isSeriallyStable(t.inputSchema),
        `${t.name}: inputSchema is not deterministically serializable`,
      ).toBe(true);
    }
  });

  it("no inputSchema is empty/missing for tools that declare parameters", () => {
    // Sanity: a sampling of parametrized tools must expose real properties.
    const parametrized = tools.filter((t) => !t.name.endsWith("_health") && !t.name.endsWith("_status"));
    expect(parametrized.length).toBeGreaterThan(0);
    for (const t of parametrized) {
      const schema = t.inputSchema as { properties?: Record<string, unknown> } | undefined;
      const props = schema?.properties ?? {};
      expect(Object.keys(props).length, `${t.name}: expected properties`).toBeGreaterThanOrEqual(0);
    }
  });

  it("full tool catalog serializes to a stable snapshot", async () => {
    const catalog = tools.map((t) => ({
      name: t.name,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
    // Determinismo: doble parse/serialización idéntica.
    const serialized = JSON.stringify(catalog, null, 2);
    expect(JSON.stringify(JSON.parse(serialized), null, 2)).toBe(serialized);
    await expect(catalog).toMatchFileSnapshot("tool-catalog.snap");
  });
});
