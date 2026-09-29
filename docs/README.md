# Documentación — Proton Suite Agent

### Propósito de este documento
- **Objetivos:** Indexar guías, ADRs y runbooks sin duplicar el canon de raíz.
- **Estructura:** Árbol canónico (`architecture` / `guides` / `runbooks`) → rutas vivas.
- **Contenido a integrar según contexto:** ADRs MADR, contrato MCP, playbooks, informes de seguridad.

Abrir cuando: Buscas una guía, ADR o informe sin saber la ruta.
Índice de `docs/`. Canon de gobernanza en la raíz ([README.md](../README.md),
[CONSTITUTION.md](../CONSTITUTION.md), [ROADMAP.md](../ROADMAP.md)).

## Estructura

| Ruta | Contenido |
| --- | --- |
| [`architecture/`](./architecture/) | Fachada canónica → [`ARCHITECTURE.md`](../ARCHITECTURE.md) + ADRs |
| [`guides/`](./guides/) | Fachada canónica de guías operativas |
| [`runbooks/`](./runbooks/) | Fachada canónica → [`playbooks/`](../playbooks/) |
| [`adr/`](./adr/) | Decisiones MADR (0001–0007) |
| [`api/mcp-tools.md`](./api/mcp-tools.md) | Contrato MCP generado (`pnpm docs:generate`) |
| Guías (raíz de `docs/`) | Quickstarts, Bridge, deploy, Drive, alertas, KB |
| [`security/`](./security/) | Informes de auditoría FASE1/FASE2 |
| [`archive/`](./archive/) | Planes históricos superseded |

## Guías

| Documento | Uso |
| --- | --- |
| [agent-quickstart.md](./agent-quickstart.md) | Tools MCP para agentes |
| [human-quickstart.md](./human-quickstart.md) | Instalación humana |
| [bridge-core.md](./bridge-core.md) | Bridge headless |
| [deployment-http-docker.md](./deployment-http-docker.md) | Docker HTTP + Pass |
| [local-stdio-secrets.md](./local-stdio-secrets.md) | Wrapper JIT |
| [drive-audit.md](./drive-audit.md) | Drive CLI |
| [alerting.md](./alerting.md) | Webhook / ntfy / logs |
| [knowledge-base.md](./knowledge-base.md) | Clasificación |
| [publishing.md](./publishing.md) | npm / GHCR |
| [renovate.md](./renovate.md) | Renovate |
| [coverage-report.md](./coverage-report.md) | Snapshot histórico de cobertura (CI es la fuente viva) |

## Playbooks / runbooks

Fachada canónica: [`runbooks/`](./runbooks/). Workflows vivos: [`../playbooks/README.md`](../playbooks/README.md).
