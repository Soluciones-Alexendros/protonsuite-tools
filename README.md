# Proton Suite Agent

### Propósito de este documento
- **Objetivos:** Orientar el pulso del repo, el quickstart y el enrutado a los documentos canónicos.
- **Estructura:** Ficha → pulso → mapa de lectura → instalación, tools, agente, calidad.
- **Contenido a integrar según contexto:** Stack TypeScript/MCP, frontera Bridge, dry-run por defecto, Makefile fachada.

Abrir cuando: Orientación, pulso y enrutado.
Aprobado: 15 de agosto de 2026
Audiencia: Agente, Dirección, Usuarios
Autoridad: Lectura
Clase: Obligatorio
Días para revisión: 14
En repo: Sí
Estado: Vigente
Orden: 1
Propósito: Punto de entrada: pulso, quickstart y qué leer después.
Reforma: Operativa
Responsable: Alexendros
Revisión: 29 de agosto de 2026
Rol: Entrada
Ruta: ./README.md

[![CI](https://github.com/Soluciones-Alexendros/protonsuite-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/Soluciones-Alexendros/protonsuite-tools/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Soluciones-Alexendros/protonsuite-tools/actions/workflows/codeql.yml/badge.svg)](https://github.com/Soluciones-Alexendros/protonsuite-tools/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Soluciones-Alexendros/protonsuite-tools/badge)](https://scorecard.dev/viewer/?uri=github.com/Soluciones-Alexendros/protonsuite-tools)
[![Coverage](https://img.shields.io/badge/coverage-98%25-brightgreen)](./docs/coverage-report.md)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](./package.json)
[![npm](https://img.shields.io/npm/v/@alexendros/protonsuite-agent)](https://www.npmjs.com/package/@alexendros/protonsuite-agent)

<aside>
📌

**Propósito**

Punto de entrada de lectura. Te dice el pulso, cómo arrancar y qué documento abrir después. Lo no negociable vive en [CONSTITUTION.md](./CONSTITUTION.md).

</aside>

---

# Estado en una mirada

**Pulso:** 24 de septiembre de 2026 · `v1.4.0`

**Fase activa:** Fase 1 (Pass / agente / DX) checklist cerrada · siguiente: Fase 2 (Calendar, bloqueada). Ver [ROADMAP.md](./ROADMAP.md).

**Métricas:** 47 tools por defecto (50 con Calendar experimental) · 965 tests · cobertura ~98% (gate 95%).

| Capa | Estado |
| --- | --- |
| Mail (Bridge IMAP/SMTP) | Operativo |
| Pass (`pass` / `gopass`) | Operativo |
| Drive (`proton-drive` CLI) | Operativo (ADR-006) |
| Calendar | Stub hasta CalDAV en Bridge (ADR-005) |
| Documentación canónica | Subfase 0 completada |

**MCP server** multi-producto para **Proton Suite**: Mail, Pass, Drive y Calendar (stub). Un agente opera el buzón, gestiona contraseñas y sincroniza archivos — local, sin exfiltrar contenido E2E.

| Modo | Descripción |
| --- | --- |
| **stdio** (default) | Sin exponer red. Ideal para agentes IA locales. |
| **streamable HTTP** | Bearer auth + origin allowlist. Docker / reverse proxy. |

---

# Qué leer a continuación

| Si necesitas | Abre | Aún no |
| --- | --- | --- |
| Lo no negociable | [CONSTITUTION.md](./CONSTITUTION.md) | ROADMAP entero |
| Orden de trabajo y fases | [ROADMAP.md](./ROADMAP.md) | Código |
| Implementar como agente | [AGENTS.md](./AGENTS.md) | ARCHITECTURE completo |
| Capas y flujos | [ARCHITECTURE.md](./ARCHITECTURE.md) | Código |
| Threat model | [SECURITY.md](./SECURITY.md) | — |
| Contribuir / PR | [CONTRIBUTING.md](./CONTRIBUTING.md) | — |
| Contrato de tools MCP | [docs/api/mcp-tools.md](./docs/api/mcp-tools.md) | — |
| Decisiones (por qué) | [docs/adr/](./docs/adr/) | — |
| Índice de guías | [docs/README.md](./docs/README.md) | — |
| Playbooks + prompts | [playbooks/README.md](./playbooks/README.md) | — |

**Primera sesión:** este README → [AGENTS.md](./AGENTS.md) §§ TL;DR + ficha → fase activa en [ROADMAP.md](./ROADMAP.md) → ADR/ancla citada.

---

## Quickstart

**Prerrequisitos:** Node ≥ 22, pnpm, Proton Mail Bridge en local, `pass` o `gopass` + `gpg` para contraseñas.

### 1. Instalar y compilar

```bash
git clone https://github.com/Soluciones-Alexendros/protonsuite-tools.git
cd protonsuite-tools
pnpm install && pnpm build && pnpm run smoke
```

### 2. Configurar variables de entorno

```bash
export PROTON_BRIDGE_USER=you@proton.me
export PROTON_BRIDGE_PASS=your-bridge-password
export PROTON_MAIL_FROM=you@proton.me
```

### 3. Conectar tu cliente MCP

```jsonc
{
  "mcpServers": {
    "protonsuite": {
      "command": "npx",
      "args": ["-y", "@alexendros/protonsuite-agent", "protonsuite-mcp"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "PROTON_BRIDGE_USER": "you@proton.me",
        "PROTON_BRIDGE_PASS": "your-bridge-password",
        "PROTON_MAIL_FROM": "you@proton.me",
        "PROTON_BRIDGE_TLS_INSECURE": "true",
        "PROTON_PASS_ENABLED": "true",
      },
    },
  },
}
```

> **Seguridad:** usa `PROTON_PASS_BRIDGE_PATH=proton/bridge/password` o el wrapper JIT en [`connectors/stdio-wrapper.sh.example`](./connectors/stdio-wrapper.sh.example) para no dejar el bridge password en disco.

### 4. Organizar el buzón (dry-run)

```bash
AGENT_DRY_RUN=true pnpm exec protonsuite-agent organize
# o: npx -y @alexendros/protonsuite-agent organize
```

El agente analiza el inbox y presenta un plan **sin aplicar cambios**. Desactiva `AGENT_DRY_RUN` solo tras revisión.

---

## Tools MCP

47 tools por defecto (50 con Calendar experimental). Lectura: `response_format: "markdown" | "json"`.

| Producto | Tools | Resumen |
| --- | --- | --- |
| **Mail** | 14 | List, search, read, send, reply, forward, flag, move, delete, attachments |
| **Pass** | 4+ | List, get (sin valores), generate, health; audit vía agente |
| **Drive** | 8+ | Status, list, download, upload, share, audit, organize |
| **Calendar** | stub | `{available: false}` hasta CalDAV vía Bridge (ADR-005) |
| **Suite / Bridge / Ecosystem / Agent** | resto | Estado unificado, Bridge, binarios, plan de agente |

Contrato generado: [`docs/api/mcp-tools.md`](./docs/api/mcp-tools.md). Guía: [`docs/agent-quickstart.md`](./docs/agent-quickstart.md).

---

## Agente

| Goal | Pipeline |
| --- | --- |
| `setup` | Verifica Bridge (IMAP + SMTP) |
| `organize` | Clasifica inbox, carpetas/etiquetas, amenazas |
| `monitor` / `alert` | Solo lectura — alertas |
| `pass-audit` | Fortaleza, duplicados, plan de rotación (dry-run) |
| `suite-status` | Reporte cross-producto |
| `discover` / `check-imap` | Conectividad |
| Drive goals | `drive-audit`, `drive-organize`, … |

### Drive CLI

```bash
sudo wget -q 'https://proton.me/download/drive/cli/linux/proton-drive' \
  -O /usr/local/bin/proton-drive && sudo chmod +x /usr/local/bin/proton-drive
proton-drive auth login
```

Requiere `DRIVE_ENABLED=true` (default). Ver [`docs/drive-audit.md`](./docs/drive-audit.md).

---

## Despliegue

```bash
docker compose up -d
```

Ver [`docs/deployment-http-docker.md`](./docs/deployment-http-docker.md). Instalador: [`scripts/install.sh`](./scripts/install.sh).

## Interfaz local

SPA estática en [`apps/web`](./apps/web) ([ADR-0007](./docs/adr/0007-spa-local-estatica.md)): landing y panel de estado. No forma parte del proceso MCP. `pnpm run build` la genera en `apps/web/dist`. Se abre sin Bridge; el panel usa el adaptador local «datos de ejemplo» y no pide credenciales. Calendar sigue en stub.

---

## Documentación

| Documento | Para quién | Qué cubre |
| --- | --- | --- |
| [`CONSTITUTION.md`](./CONSTITUTION.md) | Todos | No negociables |
| [`ROADMAP.md`](./ROADMAP.md) | Dirección / agente | Fases y criterios de salida |
| [`AGENTS.md`](./AGENTS.md) | Agentes IA | Contrato operativo |
| [`docs/human-quickstart.md`](./docs/human-quickstart.md) | Usuarios | Instalación paso a paso |
| [`docs/agent-quickstart.md`](./docs/agent-quickstart.md) | Agentes IA | Tools y ejemplos |
| [`docs/bridge-core.md`](./docs/bridge-core.md) | Operadores | Bridge headless |
| [`docs/deployment-http-docker.md`](./docs/deployment-http-docker.md) | DevOps | Docker, auth, Pass en compose |
| [`docs/local-stdio-secrets.md`](./docs/local-stdio-secrets.md) | Operadores | Wrapper JIT |
| [`docs/alerting.md`](./docs/alerting.md) | Operadores | Webhook, ntfy, logs |
| [`docs/drive-audit.md`](./docs/drive-audit.md) | Operadores | Drive CLI |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Desarrolladores | Capas y flujos |
| [`SECURITY.md`](./SECURITY.md) | Auditores | Threat model |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Contribuidores | PRs, pnpm, tests |
| [`SUPPORT.md`](./SUPPORT.md) | Usuarios | Canales de ayuda |
| [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) | Comunidad | Conducta |
| [`docs/`](./docs/README.md) | Todos | architecture / guides / runbooks |
| [`playbooks/`](./playbooks/) | Operadores | Workflows + prompts |

---

## Calidad

Fachada canónica (`Makefile`): `make lint`, `make test`, `make smoke`, `make validate`.

```bash
make validate        # lint + typecheck + test + build + smoke
pnpm run typecheck   # TypeScript strict
pnpm test            # Vitest (953+)
pnpm run coverage    # Coverage v8 — gate 95%, objetivo ≥98%
pnpm run build       # tsc → dist/ y SPA apps/web (tokens, contraste, vite)
pnpm run smoke       # stdio initialize + tools/list
pnpm run knip        # Unused deps/exports
pnpm docs:check      # mcp-tools.md en sync
```

### Seguridad (resumen)

- Bearer timing-safe, origin allowlist, rate-limit 120/min/token.
- HTTP per-session; idle eviction 30 min.
- Pass nunca expone valores — solo `{found: true}`.
- Dry-run por defecto en el agente ([CONSTITUTION.md](./CONSTITUTION.md) §4).

### Progreso de cobertura

| Fecha | Statements | Branches | Tests | Notas |
|-------|-----------|----------|-------|-------|
| Ago 2026 | **~98%** | **~95%** | **953** | Subfase 0 + Fase 1 |
| Jul 2026 | 98.07% | 93.63% | 864 | Branch hunt |
| Jun 2026 | 61.7% | — | 258 | Base |

*Conteo canónico: `pnpm test 2>&1 | grep -E 'Test Files|Tests'`.*

## Licencia

[AGPL-3.0](./LICENSE) — Copyright 2026 Alejandro Domingo Agustí (Alexendros). Sin afiliación a Proton AG.

Ver [`NOTICE.md`](./NOTICE.md) para dependencias.
