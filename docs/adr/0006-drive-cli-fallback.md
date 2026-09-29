# 0006. Drive CLI como backend primario y plan de fallback

- Estado: accepted
- Fecha: 2026-08-15
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: drive, backend, contingencia

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

Proton Suite Agent opera Drive a través del binario `proton-drive` (CLI). No
existe API pública documentada para terceros; la autenticación E2E depende del
ecosistema Proton. Si el CLI deja de mantenerse, las tools Drive quedarían
inoperativas sin plan de contingencia.

¿Qué fuerza la decisión?

- El path OAuth/API REST “Drive MVP” del ROADMAP antiguo está obsoleto: el
  producto ya habla CLI.
- Se necesita un plan B sin cambiar el contrato MCP de las tools.

Drivers:

- Continuidad operativa.
- No almacenar tokens Drive en este servidor (CONSTITUTION §6).
- Migración acotada al adapter (`src/drive.ts`).

## Opciones consideradas

- (opción A) Solo CLI `proton-drive` sin fallback documentado.
- (opción B) CLI primario + fallbacks ordenados (rclone, API si existe).
- (opción C) Reimplementar cliente OAuth propio ahora.

## Resultado de la decisión

Opción elegida: **(opción B)**.

Mantener `proton-drive` como backend primario. Fallbacks evaluables en orden:

1. **rclone** backend `protondrive` — adaptar `DriveClient` detrás de
   `IDriveClient` con superficie `{ ok, error }`.
2. **API web Proton Drive** — solo si Proton publica endpoints estables;
   OAuth/device flow y revisión AGPL; sin tokens en servidor compartido.

Hasta implementar un fallback, `proton_drive_status` DEBE reportar versión del
CLI y warning si el binario no responde.

### Consecuencias positivas

- Contrato MCP estable; migración solo en `src/drive.ts`.
- Alineado con ports (ADR-003).

### Consecuencias negativas

- Dependencia de un CLI externo hasta que exista fallback.

## Validación

- Tools Drive operativas vía CLI en tests/mocks.
- Spike rclone solo bajo `tests/` + feature flag `DRIVE_BACKEND=rclone`.

## Más información

- [ADR-003](./0003-ports-and-adapters-extraction.md)
- [Proton Drive CLI](https://proton.me/support/drive-cli)
- [rclone protondrive](https://rclone.org/protondrive/)
- Spec rclone histórico: `docs/archive/superpowers/specs/`
