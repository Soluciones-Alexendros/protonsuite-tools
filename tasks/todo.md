# tasks/todo.md — Cierre de producción PST-PROD-CLOSE-2026-10-17

Estado global: **P00 en curso**. Ninguna tarea marcada `verified` sin evidencia ligada al SHA.
Estados válidos: proposed | ready | in_progress | blocked | implemented | verified | accepted | excluded.
`implemented` **no** implica `verified`.

Base congelada: `origin/main` = `638850bb3cf26126eee757a742323eb2ddcb20b4`
(tree `fd96749ee139792ce6de69f2d025ac1f438d23b4`) al inicio del cierre. No usar
la ref local `main`.

## Lotes cerrados

| PR | Qué cierra | Estado |
|---|---|---|
| [#122](https://github.com/Soluciones-Alexendros/protonsuite-tools/pull/122) | Gate `Dependency audit`: 5 críticas y 17 altas → 0 críticas y 1 alta no parcheable. Producción sin avisos (F39/F40). Incluye la alineación de scopes de commitlint con AGENTS.md. | **mergeado** · publicó `1.6.1` |
| [#121](https://github.com/Soluciones-Alexendros/protonsuite-tools/pull/121) | F01 (pass-audit destruía credenciales), F02 (sobrescritura en organización Drive), F04 (contraseña de Bridge en el DTO público) + ADR-0008 y ledger F01–F44. | CLEAN, pendiente de merge |
| — | F18: apagar un producto ya apaga sus herramientas (19 → 5 con todo apagado). Cubierto por `tests/contract/product-gating.test.ts`. | en este PR |

---

## P00 — Congelar alcance y reproducir baseline

### P00-O01 — Baseline y ledger · `in_progress`
- Findings: (transversal) · Depends on: —
- **Hecho:** SHA y árbol reconfirmados; 12 gates ejecutados con exit code real
  (`specs/production-close/s00-baseline/baseline-receipt.json`); matriz F01–F44
  derivada (`findings.yaml`, `s00-baseline/findings-matrix.tsv`); anomalía de refs
  A01–A03 declarada (`scope.yaml`).
- **Pendiente:** revisión de los 10 hallazgos `needs-manual-review`; asignar
  `testIds` a cada F; añadir delta de revisión por A03.
- Criterio de cierre: 100% de F01–F44 con disposición + test asignado.
- Verificación: `node specs/production-close/probe-findings.mjs`

### P00-O02 — Contrato de producto y ADR de alcance · `blocked`
- Depends on: decisión del OWNER sobre perfiles y anomalías A01–A03.
- Bloqueo: los 8 ADR del plan siguen `not-written`; ninguna capacidad se declara operativa.
- Criterio de cierre: ADR-SCOPE fusionado; T-SCOPE-01 verde (capabilities declaradas == registro efectivo).

**Gate G00:** `blocked` hasta cerrar P00-O02.

---

## P01 — Contención e integridad inmediata (PR-01) · `ready`

### P01-O01 — Desactivar falsa rotación · `ready` · **P0**
- Findings: F01 · Depends on: —
- Alcance: `src/agent/executor.ts` (rama `else` de `pass-audit`), `src/pass.ts`
  (`generate`, texto de recomendación línea ~316), `src/agent-cli.ts`, tests, docs.
- Exclusión: no implementar rotación remota real en este PR; solo retirar la escritura.
- Requisito: `pass-audit` es **siempre** read-only. Generar credencial nueva queda
  en comando separado con no-clobber + backup + aprobación.
- Pruebas: `T-PASS-01` — hash del store antes/después de auditar (0 bytes
  modificados), con `AGENT_DRY_RUN=false` incluido.
- Criterio de cierre: auditar nunca invalida una credencial; `insert --force` no
  alcanzable desde `pass-audit`.

### P01-O02 — No sobrescritura Drive · `ready` · **P0**
- Findings: F02 · Depends on: —
- Alcance: `src/server/drive.ts` (`proton_drive_organize`), `src/agent/executor.ts`
  (`drive-organize`), `src/drive-audit.ts` (`buildOrganizePlan`).
- Requisito: un único motor de organización; reserva de destinos no-clobber;
  plan serializable con estrategia `reject|rename` explícita; journal por acción.
- Pruebas: `T-FS-01` — homónimos, destino preexistente, fallo intermedio.
- Criterio de cierre: 0 pérdidas silenciosas; `renameSync` no se invoca sobre destino existente.

### P01-O03 — Eliminar secretos de DTO públicos · `ready` · **P0**
- Findings: F04 · Depends on: —
- Alcance: `src/bridge/bridge-client.ts`, `src/server/bridge.ts`, `src/security.ts`.
- Requisito: lista positiva de campos en `BridgeInfo`/status/structuredContent;
  la contraseña Bridge no cruza a DTO público ni a errores.
- Pruebas: `T-SEC-01` — señuelos en todas las ramas JSON/markdown/error.
- Criterio de cierre: 0 coincidencias de señuelos en respuestas y logs.

**Gate G01:** `proposed`.

---

## P02 — Autorización, secretos y auditoría (PR-02) · `blocked`

Bloqueado en la decisión del OWNER sobre
[ADR-0009](../docs/adr/0009-authorization-y-aprobacion-vinculante.md) y la
especificación [`P02-O01`](../specs/production-close/specs/P02-O01-policy-engine.md).

Evidencia recogida para la decisión:

- **26 de 50** herramientas no son de lectura (15 de escritura, 9 destructivas) y
  ninguna exige autorización. El único freno es `AGENT_DRY_RUN`.
- Las `annotations` están mal y no pueden ser la base del control:
  `proton_calendar_create_event` declara `readOnly: true` y crea eventos;
  `proton_drive_copy`, igual, y copia ficheros; `proton_pass_get` no declara clase.
- No hay identidad de actor: hay un único bearer token compartido (`src/auth.ts`)
  y un `sessionId` por sesión (`src/http.ts`).

- P02-O01 motor de políticas + aprobación vinculante (F03, F43) — **P0**
  - [x] Catálogo de efectos, política con denegación por defecto, aprobaciones
        con consumo único y auditoría (`src/authz/`)
  - [x] Conectado al servidor: punto único de intercepción en `buildServer`
  - [x] Comando local `protonsuite-agent approve|reject|pending`
  - [x] `annotations` alineadas con el catálogo + test de contrato (cierra F43
        en lo que respecta a las herramientas publicadas)
  - [ ] Conectar también el CLI del agente y los jobs
  - [ ] Declarar política en los E2E que escriben
- P02-O02 auditoría durable + redacción (F42)
- P02-O03 secretos fuera del modelo (F06) — **P1**

## P03 — Filesystem seguro (PR-03) · `proposed`
- P03-O01 sandbox local (F05) · P03-O02 recorrido/hashing acotados (F25)

## P04 — Runtime, HTTP y cierre (PR-04) · `proposed`
- P04-O01 ownership de dependencias (F19) · P04-O02 hardening HTTP (F20–F23, F27, F28)
- P04-O03 supervisor de procesos (F24)

## P05 — Integraciones reales (PR-05..07) · `proposed`
- P05-O01 Bridge y TLS (F12–F15, F34) · P05-O02 backends de secretos (F07–F11)
- P05-O03 Drive CLI y auth (F16, F17) · P05-O04 Mail, adjuntos y cachés (F26)

## P06 — Contrato completo MCP (PR-08) · `proposed`
- P06-O01 inventario de tools: **F18 corregido** (gating por producto); falta el
  catálogo generado `mcp-surface.json` y la unificación de registro/instrumentación (F43)
- P06-O02 resources/templates · P06-O03 prompts/clientes

## P07 — Contenedores y operación (PR-09) · `proposed`
- P07-O01 imágenes mínimas verificadas (F30–F32, F36, F40) · P07-O02 persistencia y observabilidad (F33, F35)

## P08 — Calidad, CI y release (PR-10) · `in_progress`
- P08-O01 gates obligatorios: **F39 corregido** (auditoría en verde; excepciones con
  dueño y caducidad en SECURITY.md). **F40 parcial**: sigue pendiente fijar la
  toolchain (`pnpm/action-setup` con `version: latest` y `packageManager` ausente)
- P08-O02 coherencia y procedencia (F37): `package.json` sigue en **1.4.3** con npm
  publicando ya **1.6.1**; el release no escribe la versión en el repo
- P08-O03 validadores que no mienten (F41)

## P09 — Guías y producto (PR-11) · `proposed`
- P09-O01 canon y guías ejecutables (F44) · P09-O02 SPA y usabilidad

## P10 — Diagramación Archify · `proposed`
- P10-O01 toolchain fijado · P10-O02 suite D01–D24 · P10-O03 drift y publicación

## P11 — Aceptación, canary y cierre (PR-12) · `blocked`
- P11-O01 aceptación integrada · P11-O02 transferencia operativa
- Bloqueo: depende de P01–P10.

---

## Hallazgo del tablero (semáforo rojo)

| Sev | Fuente | Detalle | Disposición |
|---|---|---|---|
| P0 | escaneo secreto | `pass/gpg-setup.sh:60` (`echo -n "Enter your Bridge password: "`) | **falso positivo propuesto** |

Evidencia: la línea 60 es un `echo` de prompt y la 61 un `read -rs BRIDGE_PASS`
(entrada interactiva en runtime). Cero literales de credencial en el fichero
(84 líneas, sha256 `faf0f17e1b7f6ead6365f06671dc0b5e00388d13853f18408583576999be81a7`).
No hay `.env` versionado (solo `.env.example` y `.env.test.example`).
Requiere **revisión independiente** (rol SEC) para cerrarse como FP — regla 9 del plan.
