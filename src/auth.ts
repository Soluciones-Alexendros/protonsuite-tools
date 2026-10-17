import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Comparación timing-safe de bearer tokens.
 *
 * No retorna false por diferencia de longitud ni acorta la comparación. En su
 * lugar, calcula un HMAC-SHA256 de cada token usando el token esperado como
 * clave; los digestos tienen longitud fija (32 bytes), así que la comparación
 * con `crypto.timingSafeEqual` no revela la longitud ni la posición del primer
 * byte distinto del secreto original.
 */
export function compareTokens(received: string, expected: string): boolean {
  // Fallo cerrado en la raíz: un token esperado vacío NO puede casar con nada.
  // Sin esto, `compareTokens("", "")` devolvía `true` —los dos digestos del HMAC
  // salían iguales— y un servidor HTTP sin `MCP_AUTH_TOKEN` quedaba abierto a
  // cualquiera que no mandara cabecera (hallazgo F28).
  if (expected.length === 0 || received.length === 0) return false;

  const key = Buffer.from(expected, "utf8");
  const receivedDigest = createHmac("sha256", key).update(received).digest();
  const expectedDigest = createHmac("sha256", key).update(expected).digest();
  return (
    receivedDigest.length === expectedDigest.length &&
    timingSafeEqual(receivedDigest, expectedDigest)
  );
}

/** Longitud mínima del bearer. Por debajo, se rechaza al construir la app. */
export const MIN_TOKEN_LENGTH = 16;

/** Extracts the bearer token from an Authorization header, or "" if malformed. */
export function extractBearer(authHeader: string | undefined): string {
  if (!authHeader) return "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}
