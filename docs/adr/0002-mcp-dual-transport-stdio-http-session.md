# 0002. Dual transport — stdio and per-session Streamable HTTP

- Estado: accepted
- Fecha: 2026-01 — revisado 2026-07 (working-tree refactor a `src/server/*.ts`)
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: arquitectura, transporte, seguridad

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

El MCP server debe servir a dos públicos: agentes IA locales (un cliente MCP
inyecta el proceso vía `stdio`) y operadores/backend propios que consumen el
servidor a distancia vía HTTP (Routines, dashboards). Un transporte único no
cubre ambos casos: `stdio` no expone red (ideal para privacidad local), pero
ningún cliente remoto lo puede usar; HTTP permite acceso remoto, pero exige
autenticación, allowlist de orígenes y aislamiento de sesiones. El refactor en
progreso (`src/server.ts` → `src/server/*.ts`) requiere que esta decisión quede
documentada antes de que el resto del código la asuma.

¿Qué fuerza la decisión?

- El SDK `@modelcontextprotocol/sdk@^1.29` recomienda **un transporte por sesión**
  en HTTP: cada `Mcp-Session-Id` recibe su propio
  `StreamableHTTPServerTransport` + `McpServer`, evitando bleed de estado
  (capabilities, listas de tools, suscripciones) entre clientes concurrentes.
- `stdout` en modo `stdio` está **reservado al JSON-RPC**: cualquier byte de log
  lo corrupta. Los logs deben ir a `stderr`.
- En producción detrás de un reverse proxy, la IP del cliente es la del
  balanceador, por lo que el rate-limit y la identidad deben basarse en el
  **bearer token**, no en la IP.

Drivers de la decisión:

- Privacidad local (sin exponer red en el caso más común).
- Seguridad (fail-closed: HTTP exige bearer +, en producción, `MCP_ALLOWED_ORIGINS`
  no vacío; mitiga DNS rebinding T2).
- Escalabilidad (rate-limit 120/min/token sobre `express-rate-limit`).
- Fiabilidad (evicción de sesiones idle a los 30 min evita fugas de memoria).

## Opciones consideradas

- (opción A) Solo `stdio`.
- (opción B) Solo HTTP.
- (opción C) Dual `stdio` + HTTP con sesión por `Mcp-Session-Id`.

## Resultado de la decisión

Opción elegida: "(opción C)", porque satisface local + remoto sin duplicar la
lógica de negocio: el registro de tools (`src/server/*.ts`) es idéntico para ambos
transportes; sólo cambia el `transport` al que `McpServer.connect` se conecta.

### Consecuencias positivas

- Clientes MCP locales (Cursor, Claude Desktop) usan `stdio` sin tocar red.
- HTTP sirve a backends remotos con un modelo de autenticación y allowlist
  explícitos.
- Aislamiento por sesión previene interferencias entre clientes concurrentes.
- Rate-limit por token funciona detrás de cualquier reverse proxy.

### Consecuencias negativas

- Dos código caminos de arranque (`src/index.ts` stdio vs HTTP). El coste se
  limita a `index.ts`; `server.ts` (`buildServer`) es compartido.
- Las conexiones IMAP/SMTP se comparten entre sesiones HTTP (pool único por
  proceso), lo que es deseado pero implica que un cliente mal comportado puede
  afectar al pool. El rate-limit mitiga esto.

## Pros y contras de las opciones

### (opción A) Solo stdio

- Bueno, porque: simple, privacidad local, logs a stderr, sin authn ni cors.
- Malo, porque: imposibilita acceso remoto de Routines/dashboards.

### (opción B) Solo HTTP

- Bueno, porque: un solo camino de arranque.
- Malo, porque: fuerza authn/CORS para el caso local; un error en el allowlist
  puede bloquear al cliente local o exponer el bearer.

### (opción C) Dual

- Bueno, porque: mejor DX local + remoto; fail-closed en HTTP.
- Malo, porque: dos caminos de arranque; complejidad de gestión de sesiones.

## Más información

- Implementación: `src/index.ts` (rama stdio vs HTTP), `src/http.ts`
  (per-session transport, CORS preflight, rate-limit, `/healthz`).
- Config: `src/config.ts` `transport` schema (`MCP_TRANSPORT`, `MCP_HTTP_HOST`,
  `MCP_HTTP_PORT`, `MCP_AUTH_TOKEN`, `MCP_ALLOWED_ORIGINS`).
- `docs/agent-quickstart.md` — ejemplos de handshake stdio y HTTP.
