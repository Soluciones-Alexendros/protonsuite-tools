# Renovate — matriz de decisiones

### Propósito de este documento
- **Objetivos:** Documentar la política de actualizaciones de la fase A: la config se resuelve sin el preset org y ningún bump se fusiona solo.
- **Estructura:** Archivo canónico → matriz por tipo de dependencia → notas de merge.
- **Contenido a integrar según contexto:** Europe/Madrid, label `dependencies`, majors sin automerge, excepción MCP SDK y Docker.

Configuración: [`.github/renovate.json`](../.github/renovate.json).

Reemplaza a Dependabot **version-updates** (las GitHub Dependabot Alerts se conservan).
Base: `config:recommended` copiada en este repo. No extiende `infraestructura-stack`.

Fase A: `dependencyDashboardApproval` retiene ramas y PR de bumps hasta el checkbox del dashboard. `automerge` y `platformAutomerge` están apagados. La fase B (automerge de patch/minor solo npm, con CI verde) no forma parte de este cambio.

| Regla | ¿Qué cubre? | update-type | Auto-merge | Label extra | Razonamiento |
|-------|-------------|-------------|-----------|-------------|--------------|
| Dashboard | bumps de dependencias | todos, salvo el aviso de seguridad de abajo | nunca en fase A | `dependencies` | Evita abrir la cola acumulada al recuperar la config. |
| [1] npm patch+minor | `dependencies` + `devDependencies` | minor/patch | nunca en fase A | `dependencies` | El automerge de canon queda para una fase B aprobada aparte. |
| [2] MCP SDK | `@modelcontextprotocol/sdk` | todo | nunca | `mcp`, `mcp-sdk` | Núcleo del protocolo; apretado a `server.json`/`mcpName`/transports (ADR-002). |
| [3] Majors | todo | major | nunca | — | Revisión humana. Cuarentena `minimumReleaseAge` de 14 días. |
| [4] GitHub Actions | `github-actions` | todo | nunca | — | Cambios de `.github` con revisión humana. |
| [5] Docker base | `docker` | digest | nunca | — | Pin a digest. El manager `dockerfile` sigue activo. |
| vuln alerts | advisories | fix | nunca | `security` | Se conservan, `lowest`, sin automerge. Renovate puede abrirlas sin el checkbox del dashboard. |
| lockfile maint | pnpm-lock.yaml | — | nunca | — | Lunes antes de las 07:00, Europe/Madrid. |

**Nota sobre `automerge`:** apagado en fase A. Si una fase posterior lo enciende para npm patch/minor, los checks de PR siguen siendo `quality`, `test`, `build` y `smoke`. No hay Dependabot version-updates.
