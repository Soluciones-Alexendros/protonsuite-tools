# Arquitectura de Proton Suite Agent

### Propósito de este documento
- **Objetivos:** Describir capas, flujos MCP y la frontera criptográfica de Bridge.
- **Estructura:** Propósito → capas → módulos → flujos → ADRs.
- **Contenido a integrar según contexto:** stdio/HTTP, puertos/adaptadores, Pass/Drive/Calendar, dry-run.

Abrir cuando: Capas, módulos, flujos MCP o frontera Bridge.
Aprobado: 15 de agosto de 2026
Audiencia: Desarrolladores, Agente
Autoridad: Derivada
Clase: Obligatorio
Días para revisión: 30
En repo: Sí
Estado: Aprobado
Orden: 6
Propósito: Modelo interno, flujos y fronteras de seguridad.
Reforma: Operativa + ADR
Responsable: Alexendros
Revisión: 14 de septiembre de 2026
Rol: Arquitectura
Ruta: ./ARCHITECTURE.md

Documento de arquitectura. El [README.md](./README.md) orienta al uso; lo no
negociable está en [CONSTITUTION.md](./CONSTITUTION.md). ADRs en `docs/adr/`:

- ADR-002: transporte dual stdio + HTTP per-session.
- ADR-003: puertos/adaptadores (`src/clients/interfaces.ts`).
- ADR-004: validación de config + dry-run por defecto.
- ADR-005: Calendar CalDAV stub (bloqueado en Bridge).
- ADR-006: Drive vía CLI `proton-drive` + plan de fallback.
- ADR-007: SPA local estática en `apps/web` (landing + panel; sin Bridge embebido).

## 1. Propósito

MCP server multi-producto: **Mail** (Bridge IMAP/SMTP), **Pass** (`pass` /
`gopass`), **Drive** (`proton-drive` CLI), **Calendar** (stub hasta CalDAV).
Lectura, búsqueda, envío, organización, contraseñas y alertas — local.

## 2. Capas

```
Consumidores MCP            stdio: cliente local
                            HTTP : Bearer + Origin allowlist
        │ JSON-RPC                │
        ▼                         ▼
Proton Suite Agent (TypeScript · MCP SDK)
   config.ts · auth.ts · http.ts · server.ts · server/*
   imap.ts · smtp.ts · pass.ts · drive.ts
   clients/interfaces.ts · agent/* · alerts/*
        │ IMAP/SMTP Bridge        │ pass|gopass        │ proton-drive
        ▼                         ▼                    ▼
Proton Mail Bridge ── FRONTERA E2E ──  ~/.password-store  ~/.config/proton-drive
        │
        ▼
Servidores Proton (cifrado E2E)
```

`apps/web` es una SPA estática aparte ([ADR-007](./docs/adr/0007-spa-local-estatica.md)): landing y panel de estado con datos de ejemplo. No se importa desde `src/index.ts`, no escribe en stdout y no embebe Bridge ni CalDAV.

## 3. Módulos (`src/`)

| Módulo | Responsabilidad |
| --- | --- |
| `index.ts` | Arranque stdio/HTTP, clientes por producto, guardrails |
| `config.ts` + `config/` | Zod por producto; logger stderr |
| `auth.ts` | Bearer timing-safe |
| `http.ts` | Express + StreamableHTTP per-session, rate-limit, `/healthz`, `/metrics` |
| `server.ts` | `buildServer()`: orquesta registro |
| `server/*` | Tools por dominio (mail, pass, drive, calendar, bridge, ecosystem, suite, agent) |
| `imap.ts` / `smtp.ts` | Pools Bridge |
| `pass.ts` | `PassClient`: `pass` o `gopass` |
| `drive.ts` | `DriveClient`: CLI oficial `{ ok, error? }` |
| `clients/interfaces.ts` | Puertos `IImapClient`, `ISmtpClient`, `IDriveClient`, `IPassClient`, `ICalendarAdapter` |
| `agent/*` | Goals, organización, executor |
| `alerts/*` | Reglas + sinks file/webhook/ntfy |
| `ecosystem/*` | Discovery/install de binarios |

Calendar: tools stub en `server/calendar.ts` → `{ available: false }` (ADR-005).
No hay `src/calendar.ts` de producción.

### Claves de diseño

- Frontera cripto = Bridge.
- HTTP: un `StreamableHTTPServerTransport` por `Mcp-Session-Id`; eviction 30 min.
- Stderr-only logs en stdio.
- Split de tools por dominio **cerrado** (ADR-003).

## 4. Tools

Lista canónica generada: [`docs/api/mcp-tools.md`](./docs/api/mcp-tools.md)
(`pnpm docs:generate` / `docs:check`).

Lectura: `response_format: "markdown" | "json"` + `structuredContent`.
`proton_agent_plan` es read-only (dry-run del organizador).

### Flujo de una llamada

1. Transporte stdio o `POST /mcp` con Bearer.
2. HTTP: auth + Origin + rate-limit.
3. Validación Zod → delegación al adaptador (IMAP/SMTP/Pass/Drive).
4. Respuesta serializada; logs a stderr.

## 5. Despliegue (Docker)

`docker-compose.yml`:

- **proton-bridge**: Bridge headless + volumen vault.
- **agent**: MCP HTTP; volúmenes opcionales Pass (`~/.password-store`) y GPG;
  volumen Drive auth (`~/.config/proton-drive`).

Red `proton-net` interna; `proxy-network` externa. En producción,
`MCP_ALLOWED_ORIGINS` obligatorio.

## 6. No-objetivos

- No reimplementar crypto Proton.
- No HTTP público sin auth.
- No spoofing de `from`.
- No clasificación en LLMs externos por defecto.
- No mutaciones autónomas sin dry-run / HITL.
- No CalDAV contra Proton hasta Bridge (ADR-005).
- No embeber Bridge ni secretos en la SPA estática (ADR-007).
- No OAuth Drive en este agente (ADR-006).

## 7. Amenazas (resumen)

Detalle en [SECURITY.md](./SECURITY.md). T1–T18: bearer, DNS rebinding, SMTP
abuse, prompt injection, credenciales env, adjuntos, TLS Bridge, dry-run,
hallucination, Pass exposure, Drive enumeration, etc.

## 8. Stack

TypeScript 5.7 strict · Node ≥22 · MCP SDK · imapflow · nodemailer ·
mailparser · zod · express · Vitest. Package manager: **pnpm**.
CI: typecheck, test, coverage, build, smoke, docs:check, license-check, CodeQL.
