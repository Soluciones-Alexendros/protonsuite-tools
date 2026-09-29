# Arquitectura

### Propósito de este documento
- **Objetivos:** Enrutar al modelo interno, fronteras de seguridad y ADRs vivos.
- **Estructura:** Índice canónico `docs/architecture/` → documento raíz y MADR.
- **Contenido a integrar según contexto:** Capas MCP, Bridge como frontera E2E, puertos/adaptadores.

El documento de arquitectura canónico vive en la raíz (CONSTITUTION §2):
[`ARCHITECTURE.md`](../../ARCHITECTURE.md).

Las decisiones estructurales están en [`../adr/`](../adr/) (ADR-0001, formato MADR):

| ADR | Tema |
| --- | --- |
| [0001](../adr/0001-usar-madr-para-adrs.md) | ADRs en formato MADR |
| [0002](../adr/0002-mcp-dual-transport-stdio-http-session.md) | Transporte dual stdio + HTTP |
| [0003](../adr/0003-ports-and-adapters-extraction.md) | Puertos y adaptadores |
| [0004](../adr/0004-config-validation-and-dry-run-guardrail.md) | Config + dry-run |
| [0005](../adr/0005-calendar-caldav-stub-proton-dependency.md) | Calendar stub |
| [0006](../adr/0006-drive-cli-fallback.md) | Drive vía CLI |
| [0007](../adr/0007-spa-local-estatica.md) | SPA local estática |
