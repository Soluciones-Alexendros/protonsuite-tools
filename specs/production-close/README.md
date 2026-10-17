# specs/production-close — Índice

Cierre de producción de `Soluciones-Alexendros/protonsuite-tools`.
Plan maestro: **PST-PROD-CLOSE-2026-10-17, revisión 1.0** (documento del operador;
no se modifica desde aquí — regla «no editar el archivo del plan»).

## Base congelada

| Dato | Valor |
|---|---|
| sourceSha | `638850bb3cf26126eee757a742323eb2ddcb20b4` (`origin/main`) |
| sourceTree | `fd96749ee139792ce6de69f2d025ac1f438d23b4` |
| Árbol de trabajo | idéntico al baseline (mismo tree hash) |
| lockfile sha256 | `3af38688d90c7465db247d78d6dac485ba96587a89ac1639b51745eaa5b7f359` |
| Toolchain | Node v26.6.0 · pnpm 11.21.0 |

No usar la ref local `main` (diverge y elimina `apps/web`). Ver `scope.yaml` → A02.

## Artefactos

| Ruta | Contenido |
|---|---|
| `scope.yaml` | Congelación de alcance (borrador), anomalías de refs, perfiles propuestos, ADR pendientes |
| `findings.yaml` | Ledger F01–F44 con disposición estática |
| `probe-findings.mjs` | Sonda reproducible que deriva la matriz desde el árbol (solo lectura) |
| `run-baseline.sh` | Ejecutor de T-BASE-01 (gates con exit code real) |
| `s00-baseline/baseline-receipt.json` | Receipt de gates del baseline |
| `s00-baseline/baseline-gates.log` | Log íntegro de la ejecución |
| `s00-baseline/findings-matrix.tsv` | Matriz F01–F44 en bruto |
| `../tasks/todo.md` | Desglose de tareas por fase y gate |

## Reproducir

```bash
cd <repo>
node specs/production-close/probe-findings.mjs
bash specs/production-close/run-baseline.sh "$PWD" "$PWD/specs/production-close/s00-baseline"
```

## Baseline de gates (T-BASE-01) — todos exit 0

`install-frozen` · `lint` · `typecheck` · `test` (965/965, 49 ficheros) · `build`
· `test:contract` (11/11) · `smoke` (initialize + **39 tools**) · `coverage`
(98.19% stmts / 95.17% branch) · `docs:generate` · `docs:check`.

Nota: el árbol fuente contiene **50** nombres `proton_*`; el runtime lista **39**.
El inventario efectivo debe medirse en runtime, no por grep (plan §5.5, P06-O01).

## Estado

- P00-O01 `in_progress` — falta revisar 10 hallazgos y asignar `testIds`.
- P00-O02 `blocked` — pendiente de decisión del OWNER.
- Semáforo del tablero: **rojo**, por un falso positivo de escáner en
  `pass/gpg-setup.sh:60`. Evidencia y disposición en `../tasks/todo.md`.
