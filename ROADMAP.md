# ROADMAP.md

### Propósito de este documento
- **Objetivos:** Ordenar el trabajo en fases verificables con criterio de salida.
- **Estructura:** Reglas → fases → hitos y dependencias de Bridge/Calendar.
- **Contenido a integrar según contexto:** Fase activa, ADRs citados, checklist de salida.

Abrir cuando: Fase activa, hitos o criterio de salida.
Aprobado: 15 de agosto de 2026
Audiencia: Agente, Dirección
Autoridad: Operativa
Clase: Obligatorio
Días para revisión: 14
En repo: Sí
Estado: Aprobado
Orden: 8
Propósito: Orden de ejecución en fases verificables.
Reforma: Operativa
Responsable: Alexendros
Revisión: 29 de agosto de 2026
Rol: Plan
Ruta: ./ROADMAP.md

<aside>
📌

**Propósito**

Transforma el estado del producto en unidades de trabajo. Cada fase tiene objetivo, traza (ADR/CONSTITUTION), checklist y criterio de salida. El detalle de releases vive en `CHANGELOG.md`.

</aside>

---

# 1. Reglas

- Cada tarea DEBE caber en la ficha de [AGENTS.md](./AGENTS.md) § Unidad de trabajo.
- Ninguna fase se cierra con deuda crítica de seguridad, tests o documentación viva contradictoria.
- Calendar contra Proton permanece bloqueado (ADR-005) hasta CalDAV en Bridge.
- La SPA local estática de `apps/web` (landing y panel de estado, sin Bridge ni secretos) está autorizada por [ADR-0007](./docs/adr/0007-spa-local-estatica.md).
- Drive OAuth / API no es el path activo; el backend es `proton-drive` CLI (ADR-006).
- Tamaño relativo: S / M / L.

---

# 2. Estado actual

`v1.2.1` — Mail + Pass + Drive CLI + Calendar stub + contract tests + métricas HTTP.

**Fase activa:** Fase 1 cerrada en checklist · siguiente candidata Fase 2 (Calendar, bloqueada).

---

# 3. Completado (histórico condensado)

- [x] Rebrand Proton Suite (`@alexendros/protonsuite-agent`).
- [x] Pass vía `pass` CLI; tools list/get/generate/health.
- [x] Drive vía `proton-drive` CLI (list/upload/download/share/audit).
- [x] Profesionalización: ESLint, commitlint, Husky, Knip, semantic-release, Renovate.
- [x] ADRs 0002–0006; `AGENTS.md`; `docs:generate` → `docs/api/mcp-tools.md`.
- [x] `/metrics`, contract tests (50 tools), ports en `src/clients/interfaces.ts`.
- [x] Split `src/server.ts` → `src/server/{mail,pass,drive,calendar,bridge,ecosystem,agent,suite}.ts`.
- [x] Alert sinks: file + webhook + ntfy (`src/alerts/`).
- [x] Auto-labeler CI (`.github/workflows/labeler.yml`).

---

# 4. Subfase 0 — Canon documental y limpieza

**Objetivo:** docs alineados con el código; sin links rotos ni marca antigua.

**Traza:** [CONSTITUTION.md](./CONSTITUTION.md); estilo de gobernanza adaptado de nuevowebsite-alexendrosdev.

**Tamaño:** M

**Checklist:**

- [x] `CONSTITUTION.md` + README pulso/enrutado + ROADMAP fichado.
- [x] `AGENTS` / `ARCHITECTURE` / `SECURITY` / `CONTRIBUTING` actualizados.
- [x] `docs/README` real; archive `docs/superpowers` superseded.
- [x] Rebrand “Proton Mail Agent” → Suite; `npm` → `pnpm` en docs vivos.
- [x] ADRs 0001/0003/0006 normalizados; playbooks índice + prompts.

**Criterio de salida:** README sin rutas fantasma; ningún doc vivo afirma “Drive stub/OAuth pendiente”; conteos tools/tests coherentes; `pnpm docs:check` OK.

---

# 5. Fase 1 — Pass, agente y hardening DX

**Depende de:** Subfase 0.

**Objetivo:** backend `gopass`, audit con plan de rotación (dry-run), Pass en compose, DX residual.

**Traza:** CONSTITUTION §§4–5; ADR-003; ADR-004.

**Tamaño:** M

**Tareas:**

- [x] Backend `gopass` drop-in (`PROTON_PASS_BACKEND` / `GOPASS_STORE_DIR`) + tests.
- [x] `pass-audit`: reporte + `rotationPlan`; dry-run por defecto; regeneración solo con `AGENT_DRY_RUN=false`.
- [x] Docker Compose: volúmenes Pass/gpg documentados y listos.
- [x] Coverage badge en README; alerting.md documenta webhook/ntfy (env `ALERT_NTFY_*`).

**Exclusiones:** CalDAV Proton; OAuth Drive; monorepo; dashboard web.

**Criterio de salida:** `pass-audit` usable en dry-run con plan de rotación; gopass cubierto por tests; deploy docs al día; checklist Fase 1 firmada.

---

# 6. Fase 2 — Calendar MVP (bloqueada)

**Depende de:** CalDAV expuesto por Proton Bridge (ADR-005).

**Objetivo:** implementar `ICalendarAdapter` real y tools `proton_calendar_*`.

**Hasta entonces:** stub + `{available:false}`.

---

# 7. Backlog

- Plugin system Pass (Bitwarden / 1Password CLI) además de pass/gopass.
- Monorepo / Turborepo si el proyecto crece.
- Dashboard web opcional de alertas.
- Fallback Drive rclone cuando el remote `protondrive` esté estable (ADR-006).
