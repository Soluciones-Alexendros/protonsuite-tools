# Security policy — Proton Suite Agent

### Propósito de este documento
- **Objetivos:** Definir versiones soportadas, canal de reporte y el threat model del agente.
- **Estructura:** Versiones → reporte → amenazas por capa → controles presentes.
- **Contenido a integrar según contexto:** Mail/Pass/Drive/Calendar, transporte MCP, dry-run y secretos.

## Supported versions

Only the `main` branch and the latest published artifacts receive security fixes:

- npm package: `@alexendros/protonsuite-agent@latest`
- Docker image: `ghcr.io/iniciativas-alexendros/protonsuite-tools:latest`

Older versions published under the legacy names `@alexendros/protonmail-agent` and `@alexendros/protonmail-mcp` are deprecated and no longer supported.

## Reporting a vulnerability

Email `security@alexendros.me` (PGP key in the website). Do not open public GitHub issues for vulnerabilities. We aim to acknowledge within 7 days and release a fix within 30 days for critical issues.

---

## Threat model

### Server-level threats (MCP transport)

| Id | Threat | Likelihood | Impact | Mitigation |
|----|--------|------------|--------|------------|
| T1 | **MCP bearer token leaked** (logs, env dump, client-side) | Medium | High — full mailbox read/write on behalf of the user | Rotate with `openssl rand -hex 32`, update all consumers; rate limit caps abuse to 120 req/min; audit logs monthly |
| T2 | **DNS rebinding** (local network attacker causes victim's browser to hit `localhost:8787`) | Low | High | `MCP_ALLOWED_ORIGINS` allowlist enforced on every request; in production the server refuses to start without it |
| T3 | **SMTP relay abuse via `proton_send_email`** (leaked token used for spam) | Medium | Medium | Rate limit by token; Proton Bridge enforces its own daily send limit; `from` is fixed to configured address (no spoofing) |
| T4 | **Prompt injection via email body** (hostile email instructs the agent to exfiltrate/destroy) | High (for any mail-reading agent) | High | Treat bodies as untrusted; destructive tools require human confirmation; do not auto-forward or auto-reply based on untrusted body content |
| T5 | **IMAP credential theft from env** | Low | High — direct access to entire mailbox | Credentials only in deployment secrets / local `.env` (0600); never committed; rotated by regenerating Bridge mailbox password |
| T6 | **Attachment contents exfiltrated via LLM context** | Medium | Medium | `max_bytes` cap (default 10 MB, hard cap 50 MB) truncates large attachments; operator must review before forwarding |
| T7 | **Transport downgrade (MITM on local Bridge TLS)** | Low | Medium | Bridge listens on `127.0.0.1` by default; in Docker, stays inside the internal network. For strict setups set `PROTON_BRIDGE_CA_PATH` and `PROTON_BRIDGE_TLS_INSECURE=false` to pin Bridge's CA |

### Agent-level threats (autonomous email operations)

| Id | Threat | Likelihood | Impact | Mitigation |
|----|--------|------------|--------|------------|
| T8 | **Unauthorized autonomous action** (agent deletes, moves or sends without explicit approval) | Medium | High | Human-in-the-loop (HITL) gate for destructive, bulk or first-time actions; dry-run mode by default for organize/setup pipelines |
| T9 | **Hallucination in classification** (agent mislabels legal/banking/administrative emails) | Medium | High | Confidence scoring; suggested actions are presented, not applied, until operator confirms; review logs in `logs/alerts-*.jsonl` |
| T10 | **Goal injection** (malicious email or prompt hijacks the agent's objective pipeline) | Medium | High | Goal pipeline is allowlisted; untrusted content cannot redefine goals; origin and intent logging for every agent decision |
| T11 | **Data retention and audit gaps** (agent decisions are not traceable) | Low | High | All agent actions, classifications and alert triggers are written to structured audit logs; alert dispatcher can mirror to webhook |
| T12 | **Alert fatigue or missed alerts** (webhook misconfigured or noisy rules) | Medium | Medium | Severity levels (`info`, `warning`, `alert`, `critical`); min-severity threshold configurable; fallback to file and stderr |

### Product-specific threats

| Id | Threat | Likelihood | Impact | Mitigation |
|----|--------|------------|--------|------------|
| T13 | **Pass secret exposure in logs or MCP responses** | Medium | Critical — all stored credentials leaked | PassClient never logs values; `proton_pass_get` returns `{found:true}` without the secret; injection via fd/env, not JSON-RPC body |
| T14 | **Pass vault enumeration via token leak** | Medium | Critical — attacker maps entire credential inventory | `proton_pass_list` returns only entry names, never values; rate limit; require explicit confirmation for full vault listing |
| T15 | **Pass store injection via malicious entry** | Low | High — attacker plants credential in vault | Validate paths against disallowed characters; never accept raw user input for write without operator confirmation |
| T16 | **Calendar event injection** (hostile payload in event description) | Medium | High | Sanitize descriptions before processing; no auto-execution based on event content; stub-only until backend available |
| T17 | **Drive file enumeration** (CLI auth or token leak exposes file tree) | Medium | High | Rate-limit on Drive tools; never expose host absolute paths in responses; auth lives in `proton-drive` CLI config (`~/.config/proton-drive`), not in this server; no OAuth tokens stored here (ADR-006) |
| T18 | **Cross-service correlation leak** (usage patterns across Mail/Pass/Calendar/Drive reveal sensitive metadata) | Low | Medium | Do not include cross-referenced metadata in individual tool responses; only expose aggregation in `proton_suite_status` |

---

## Security controls present

### MCP server

- **Bearer token auth** on all `/mcp` requests, timing-safe comparison (`src/auth.ts`).
- **Origin allowlist** (`MCP_ALLOWED_ORIGINS`) — production refuses to start without it.
- **Rate limiting** — 120 req/min per token on `/mcp`.
- **Per-session transports** — one `StreamableHTTPServerTransport` per MCP session id, avoiding state bleed between clients.
- **Session idle eviction** — sessions unused for 30 min are closed.
- **Attachment size cap** — default 10 MB, hard cap 50 MB.
- **No secrets in logs** — logger writes to stderr only; request bodies are not logged.
- **Stdout reserved for MCP JSON-RPC** in stdio mode — logs go to stderr to avoid corrupting the protocol stream.

### Agent

- **Human-in-the-loop** — destructive, bulk or first-time actions require explicit confirmation in the agent pipeline.
- **Dry-run by default** — `agent:organize` and `agent:setup` present their plan before applying changes.
- **Structured audit log** — every agent decision, classification and alert trigger is written to `logs/audit-YYYY-MM-DD.jsonl`.
- **Alert dispatcher** — supports `stderr`, file output and webhook notification for content-triggered alerts (`src/alerts/`).
- **Knowledge base** — classification rules and professional conventions are versioned and auditable, not hidden in prompt context.

### Proton Pass

- **Zero secret exposure** — `proton_pass_get` returns `{found: true, injected: true}` without the secret value. Secrets are injected via environment variable or file descriptor, never in MCP response bodies, logs, or chat context.
- **Audit-only generation** — `proton_pass_generate` confirms the password was created (path, length, timestamp) but never returns or logs the generated value.
- **Path validation** — entry paths are validated against a safe character set before any CLI invocation, preventing shell injection via `pass` commands.
- **Local-only** — all `pass` operations happen on the same machine via `child_process.execFile` (no shell interpolation). No network calls, no external services.

---

## AI agent security baseline (OSS standard)

This project follows the following baseline for open-source AI agents that operate on user data:

1. **Transparency**: the agent declares its capabilities, data sources and decision boundaries before acting (`src/agent/goals.ts`, `docs/agent-quickstart.md`).
2. **Human control**: the operator can review, approve, reject or abort any autonomous plan before execution.
3. **Least privilege**: the agent only reads the mailboxes it needs and never writes beyond the scope approved by the operator.
4. **Auditability**: every action is logged with timestamp, goal, inputs (sanitized), decision and outcome.
5. **Fail-closed**: on ambiguity, high-severity alert or missing confirmation, the agent stops and asks the operator.
6. **No training data exfiltration**: email contents are not sent to external LLM providers by default; the local agent works against the Bridge IMAP/SMTP interface.

---

## Operator checklist before going live

- [ ] `MCP_AUTH_TOKEN` generated with `openssl rand -hex 32` and stored only in deployment secrets.
- [ ] `MCP_ALLOWED_ORIGINS` limited to exact trusted origins (HTTP mode).
- [ ] Image registry uses digest pinning if possible.
- [ ] Bridge vault volume backed up weekly.
- [ ] Agent pipeline configured in dry-run mode until the operator validates its behavior.
- [ ] `ALERT_WEBHOOK_URL` configured for critical alerts (optional but recommended).
- [ ] Review automated workflows quarterly — remove any that invoke destructive tools without human-in-the-loop.

---

## What this agent does NOT protect against

- An attacker who controls the **Bridge host** itself (OS-level access) can read the vault.
- An attacker who **steals both your Proton Mail account password AND the Bridge mailbox password** can impersonate you regardless of this agent.
- The **E2E encryption guarantee of Proton stops at the Bridge boundary** — anything downstream (this agent, the MCP server, any dashboard) operates on plaintext by design.
- The static SPA in `apps/web` (ADR-0007) shows example data only. It must not embed Bridge credentials, Pass values, or mailbox bodies, and it is not a control plane.
- The agent is a classifier and workflow helper, not a legal or compliance advisor. Operator is responsible for final decisions on sensitive categories (legal, fiscal, health, official communications).
