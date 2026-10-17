import { describe, it, expect } from "vitest";
import { compareTokens, extractBearer } from "../src/auth.js";

describe("compareTokens · timing-safe bearer comparison", () => {
  it("returns true when tokens match", () => {
    expect(compareTokens("abc123", "abc123")).toBe(true);
  });

  it("returns false when tokens differ in content (same length)", () => {
    expect(compareTokens("abc123", "abc124")).toBe(false);
  });

  it("returns false when tokens differ in length (prevents length-probe timing leak)", () => {
    expect(compareTokens("abc", "abc123")).toBe(false);
    expect(compareTokens("abc123", "abc")).toBe(false);
  });

  it("un token esperado vacío NUNCA casa (fallo cerrado, F28)", () => {
    // Antes devolvía `true`: los dos digestos del HMAC salían iguales cuando la
    // clave y el mensaje eran la cadena vacía. Eso dejaba abierto un servidor
    // HTTP sin MCP_AUTH_TOKEN a cualquiera que no mandara cabecera.
    expect(compareTokens("", "")).toBe(false);
    expect(compareTokens("lo-que-sea", "")).toBe(false);
    expect(compareTokens("", "esperado-suficientemente-largo")).toBe(false);
  });

  it("returns false when only one is empty", () => {
    expect(compareTokens("", "nonempty")).toBe(false);
    expect(compareTokens("nonempty", "")).toBe(false);
  });

  it("handles hex tokens of openssl rand -hex 32 length (64 chars)", () => {
    const token = "a".repeat(64);
    expect(compareTokens(token, token)).toBe(true);
    expect(compareTokens(token, "b".repeat(64))).toBe(false);
  });
});

describe("extractBearer · Authorization header parser", () => {
  it("extracts token from a well-formed header", () => {
    expect(extractBearer("Bearer mytoken")).toBe("mytoken");
  });

  it("returns empty string for missing header", () => {
    expect(extractBearer(undefined)).toBe("");
  });

  it("returns empty string for non-Bearer schemes", () => {
    expect(extractBearer("Basic dXNlcjpwYXNz")).toBe("");
  });

  it("returns empty string for empty header", () => {
    expect(extractBearer("")).toBe("");
  });

  it("is case-sensitive on the 'Bearer' prefix (per spec)", () => {
    expect(extractBearer("bearer mytoken")).toBe("");
  });
});
