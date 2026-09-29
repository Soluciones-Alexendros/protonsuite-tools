# AGENTS.md — Proton Suite Agent

### Propósito de este documento
- **Objetivos:** Contratar al agente de código: ficha, autonomía, DoD y comandos.
- **Estructura:** TL;DR → ficha → layout → build/test → convenciones y gotchas.
- **Contenido a integrar según contexto:** Dry-run, secretos, Calendar stub, Makefile fachada (`lint`/`test`/`smoke`/`validate`).

Abrir cuando: Vas a escribir código: ficha, autonomía, DoD y comandos.
Aprobado: 15 de agosto de 2026
Audiencia: Agente, Dirección
Autoridad: Operativa
Clase: Complementario
Días para revisión: 90
En repo: Sí
Estado: Aprobado
Orden: 9
Propósito: Contrato operativo del agente de código (convención [agents.md](https://agents.md)).
Reforma: Operativa
Responsable: Alexendros
Revisión: 13 de noviembre de 2026
Rol: Contrato
Ruta: ./AGENTS.md

<aside>
📌

**Propósito**

Contrato operativo para agentes (y humanos) que trabajan en este repo. Deriva de [CONSTITUTION.md](./CONSTITUTION.md). No reabre decisiones aceptadas en ADRs.

</aside>

> Multi-product MCP server for Proton Suite: Mail (Bridge IMAP/SMTP), Pass
> (`pass` / `gopass`), Drive (official CLI), Calendar (stub). Local operation
> without exfiltrating E2E content.

## TL;DR

- **Stack:** TypeScript 5.7 strict (`ES2022`/`NodeNext`/`ESM`), Node ≥ 22,
  `@modelcontextprotocol/sdk@^1.29`, `imapflow`, `nodemailer`, `mailparser`,
  `zod`, `express` + `express-rate-limit`. Vitest (**965** tests, **~98%**
  coverage, 95% gate). ESLint flat config (strict).
- **Build:** `pnpm install && pnpm build` → `dist/`. Source `src/`, tests
  `tests/`, docs `docs/`, playbooks `playbooks/`.
- **Entry points:** `src/index.ts` (MCP stdio/HTTP) and `src/agent-cli.ts`
  (`setup`, `organize`, `pass-audit`, `suite-status`, `drive-audit`, …).
- **stdout = JSON-RPC only.** Logs → stderr (`createLogger` in `src/config.ts`).
- **Dry-run by default:** mutate only if `AGENT_DRY_RUN=false`. Review
  `proton_agent_plan` first.
- **Secrets:** never log. `PassClient` returns `{ found: true }` only.
- **Calendar = stub** until Bridge CalDAV (ADR-005).
- **Prefer** `src/server/*.ts` + ports in `src/clients/interfaces.ts` (refactor
  cerrado).

## Unidad de trabajo (ficha)

```
Objetivo: <resultado verificable en una frase>
Traza: <CONSTITUTION § / ADR / ROADMAP fase>
Alcance: <archivos o rutas que SÍ tocas>
Exclusiones: <lo que NO harás>
Dependencias: <si aplica>
Pruebas: <comandos pnpm>
Criterio de cierre: <observable: CI, test, docs>
```

Una sesión = una unidad cohesiva. PR pequeño. CI verde antes de pedir revisión.
Mensajes al humano y commits en español (Conventional Commits).

## Repository layout

```
src/
  index.ts            # Boot: stdio o HTTP. Signal handlers, fail-closed.
  http.ts             # Express: per-session StreamableHTTP, bearer, rate-limit.
  config.ts           # Zod env; createLogger → stderr.
  config/             # Sub-schemas: bridge, pass, drive, calendar.
  server.ts           # buildServer(): orquesta registro de tools.
  server/             # mail, pass, drive, calendar, bridge, ecosystem, suite, agent
                      # + types.ts, utils.ts, structured-content.ts
  imap.ts / smtp.ts   # Pools Bridge.
  pass.ts             # PassClient: pass | gopass (execFile, path validation).
  drive.ts            # DriveClient: proton-drive CLI, {ok:false,error}.
  security.ts         # SecretSafety, makeSecretLogger.
  clients/            # Ports: IImapClient, ISmtpClient, IDriveClient, IPassClient, ICalendarAdapter.
  agent/              # Parser, organizer, classifier, executor.
  alerts/             # Rules + sinks (file / webhook / ntfy).
  ecosystem/          # Binary discovery / install.
tests/                # Unit; **/*.integration.ts; **/*.e2e.ts
docs/                 # ADRs, api/, guías, security/, archive/
                      # + architecture/, guides/, runbooks/ (fachadas canónicas)
playbooks/            # Workflows humanos + prompts (runbooks vivos).
apps/web/             # SPA estática Vite (ADR-0007). Fuera del proceso MCP.
```

## How to build, run, test

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test               # ~965 tests, gate 95%, keep ≥98%
pnpm test:integration
pnpm run test:e2e
pnpm run smoke
pnpm docs:check
make validate           # fachada canónica: lint + typecheck + test + build + smoke
```

## Conventions

- **ESLint** flat (`eslint.config.mjs`). Zero errors. Named exports.
- **Commits:** Conventional Commits + commitlint. Scopes: `imap`, `smtp`,
  `http`, `agent`, `alerts`, `pass`, `config`, `deps`, `release`, `ci`, `docs`,
  `tests`, `ecosystem`, `calendar`, `drive`, `bridge`, `security`, `web`.
- **Branches:** `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `agent/`;
  rebase onto `main`; squash-merge.
- **exactOptionalPropertyTypes** + **noUncheckedIndexedAccess** ON.
- **Deps:** AGPL-compatible only. Prefer stdlib.
- **Errors:** adapters `{ ok, error? }`; MCP `{ isError: true }` or throw.
  No parallel `Result<T,E>` monad (ADR-004).
- **Tools:** Zod `inputSchema`; read tools `response_format` + `structuredContent`.

## Gotchas

- UIDs IMAP, no sequence numbers.
- Bridge = crypto boundary. Drive = CLI only (ADR-006). No Drive tokens here.
- `pass`/`gpg`/`gopass` are external binaries — mock in unit tests.
- Do not implement Proton CalDAV until Bridge ships it (ADR-005).

## Decisions

ADRs in [`docs/adr/`](./docs/adr/). Related: [ARCHITECTURE.md](./ARCHITECTURE.md),
[SECURITY.md](./SECURITY.md), [docs/api/mcp-tools.md](./docs/api/mcp-tools.md),
[ROADMAP.md](./ROADMAP.md).

## Learned User Preferences

- No incluir trailers `Co-authored-by` de Cursor/IA en commits.
- Commits firmados (SSH/GPG según la config local) y verificados en GitHub.
- PRs pequeños y enfocados; merge solo con CI verde (squash-merge).
- Al implementar un plan adjunto, no editar el archivo del plan.
- Documentación al estilo de `nuevowebsite-alexendrosdev` (cabeceras Abrir cuando / autoridad / ficha).
- Tras merge, actualizar docs del repo; Notion solo si el usuario indica el destino explícito.

## Learned Workspace Facts

- Los secretos de CI/integración viven en GitHub **Organization secrets** (y environments), no en `.env` ni archivos locales del repo; `.env` está en `.gitignore`. Mail: `PROTON_BRIDGE_USER` / `PROTON_BRIDGE_PASS` / `PROTON_MAIL_FROM`. Alertas ntfy (opcionales): `ALERT_NTFY_TOPIC`, `ALERT_NTFY_URL`, `ALERT_NTFY_TOKEN` — ver `docs/alerting.md`.
- Repo GitHub: `Soluciones-Alexendros/protonsuite-tools` (paquete `@alexendros/protonsuite-agent`).
- Canon documental: `CONSTITUTION.md` (suprema) → `AGENTS.md` (operativo) → ADRs; no reabrir ADRs aceptados.
- Calendar MCP queda detrás de `PROTON_CALENDAR_EXPERIMENTAL` (stub hasta Bridge CalDAV / ADR-005).
- Pass soporta backend `pass` o `gopass` vía config (`PASS_BACKEND`).
- En main: rate tiers HTTP por clase de tool, caché IMAP con invalidación por fingerprint, mutex de paths Drive, Bridge fail-closed ante prompts desconocidos.
- Publicación npm: `@alexendros/protonsuite-agent@1.4.3` en registry; `npmPublish: true` vía secret org `NPM_TOKEN` (OIDC/Trusted Publisher opcional después); checklist en `docs/publishing.md`.
- Labels GitHub: taxonomía `type:` / `area:` / `priority:` / `status:` / `release:`; en `.github/labeler.yml` las claves van entre comillas.
- Pre-commit/husky: actionlint pinneado vía `scripts/run-actionlint.sh` (no `docker://…:latest`).
