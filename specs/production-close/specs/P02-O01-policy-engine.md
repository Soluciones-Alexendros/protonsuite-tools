# P02-O01 — Motor de políticas y aprobación vinculante (especificación)

Estado: **propuesta, pendiente de aprobación del OWNER.**
No se ha implementado nada. Ninguna tarea de este documento puede marcarse
`implemented` sin PR, test y evidencia ligada al SHA.

- Traza: `PST-PROD-CLOSE-2026-10-17` → fase P02, objetivo P02-O01.
- Hallazgos: F03 (ausencia de aprobación vinculante), F43 (anotaciones que no
  corresponden a efectos reales), F06 (secretos como argumentos MCP).
- Decisión previa obligatoria: `ADR-AUTHZ` = [ADR-0009](../../../docs/adr/0009-authorization-y-aprobacion-vinculante.md).
- Tests del plan: `T-AUTHZ-01`, `T-INJECT-01`, `T-RACE-01`.

---

## Fase 0 — Mapa de capacidades

El objetivo agrupa cuatro capacidades con consumidores y criterios distintos.
Cada una se puede entregar y verificar por separado, en este orden (dependencia
en un solo sentido):

| Id | Capacidad | Aporte | Se puede cortar sin reescribir el resto |
|---|---|---|---|
| `authz-catalog` | Catálogo de efectos en servidor + decisión de política con denegación por defecto | Es el cimiento: sin él no hay nada que aprobar | No (es la base) |
| `authz-journal` | Registro de intención/decisión/efecto con `correlationId` | Hace auditable lo anterior | Sí (queda sin traza, no sin control) |
| `authz-approval` | Solicitudes, grants vinculantes, consumo único y canal local | Añade la aprobación humana | Sí: con el catálogo solo, la política puede ser «denegar toda escritura» |
| `authz-surface` | Extender el catálogo a CLI y jobs, y coherencia con `annotations` | Cierra el bypass por otras rutas | Sí (deja un bypass conocido documentado) |

**Recomendación de corte para el primer PR:** `authz-catalog` y `authz-journal`.
Con eso la garantía del plan («sin aprobación independiente, cero efectos
mutativos») se cumple **denegando**, sin construir aún el canal de aprobación.
`authz-approval` va en el PR siguiente.

---

## Supuestos declarados

Se exponen porque cambian el diseño y no están decididos:

1. **Un solo operador.** Hay un único bearer token compartido; no existe
   identidad de actor. El grant se vinculará a `sessionId` y a una identidad
   declarada por el operador, no a una identidad autenticada por usuario.
2. **El canal de aprobación es local y por CLI.** No se construye UI ni servicio
   de aprobaciones.
3. **`AGENT_DRY_RUN` se conserva** como capa global de seguridad por encima de la
   política. No se elimina en este objetivo.
4. **No se atienden datos reales** para probar: todo con cuentas y fixtures de
   prueba.
5. El catálogo se escribe a mano por herramienta; no se infiere de los
   `annotations` ni de los nombres.

## Objetivo

Que ninguna herramienta mutativa pueda producir un efecto sin que el servidor lo
haya autorizado de forma explícita, determinista y verificable, con
independencia de lo que el modelo decida o de lo que declare el cliente.

## Comandos

Los que ya existen y se reutilizan:

```bash
pnpm run lint
pnpm run typecheck
pnpm test                 # unit + contract
pnpm run test:contract    # tools/list y schema por el transporte HTTP
pnpm run smoke
pnpm run coverage
```

Nuevos, propuestos (no existen hoy):

```bash
pnpm run test:authz        # T-AUTHZ-01
pnpm run test:authz:race   # T-RACE-01
pnpm run test:inject       # T-INJECT-01
```

## Estructura del proyecto

```text
src/
  authz/
    effect-class.ts        # tipo cerrado y su derivación desde el catálogo
    catalog.ts             # efecto, scopes, recursos y política por toolId
    policy.ts             # PolicyDecision = allow | require_approval | deny
    journal.ts            # registro con correlationId
    approval-store.ts     # solicitudes y grants (PR de authz-approval)
    index.ts
  server/
    <producto>.ts          # pasa a declarar su entrada de catálogo por tool
tests/
  authz/
    catalog.test.ts        # coherencia catálogo ↔ annotations
    policy.test.ts         # denegación por defecto, allow/deny/require
    journal.test.ts
    approval.test.ts       # binding, caducidad, replay, actor, política
    race.test.ts           # consumo concurrente
    inject.test.ts         # contenido hostil
```

## Estilo de código

- Las convenciones del repo: TypeScript strict, `exactOptionalPropertyTypes` y
  `noUncheckedIndexedAccess`; exports con nombre; sin comentarios que narren el
  código.
- El catálogo es **datos**, no lógica: una entrada por herramienta, legible en
  una revisión.
- Los errores usan el patrón existente (`{ ok, error? }` en adaptadores,
  `{ isError: true }` o `throw` en MCP). No se introduce un `Result<T,E>` nuevo
  (ADR-004).
- Nada de secretos en argumentos, logs, métricas ni en el mensaje de error.

## Estrategia de pruebas

Siguiendo `plan-validation` (rojo → verde → refactor):

- **Contrato:** el catálogo y los `annotations` publicados coinciden; un test
  falla si divergen. Es la red que impide que F43 vuelva.
- **Negativos, que son el punto:** sin grant no hay efecto, en cada clase
  mutativa y por cada transporte.
- **Carrera:** dos llamadas concurrentes con el mismo grant → como máximo un
  efecto, verificado contando efectos reales, no llamadas a un mock.
- **Inyección:** un correo o nombre de fichero hostil que pida una mutación no la
  consigue sin aprobación independiente.
- **Fallos del entorno:** sin canal de aprobación, sin permisos en el spool,
  spool lleno, auditoría caída → fallo cerrado y mensaje accionable.
- Los tests no se apoyan en snapshots para sustituir aserciones semánticas.

## Límites

**Dentro:** catálogo de efectos, decisión de política, denegación por defecto,
journal, grants vinculantes con consumo único, canal de aprobación local, tests
negativos, y coherencia catálogo ↔ `annotations`.

**Fuera (y por qué):**

- Motor de políticas externo (OPA/Cedar): amplía el alcance sin necesidad
  demostrada.
- Tokens por actor, cuotas por identidad y revocación por usuario: requiere
  decisión propia (cuestión abierta nº 1 del ADR-0009).
- Rotación de credenciales en el servicio remoto: es otro objetivo.
- `resources` y `prompts` de MCP: no existen hoy (`-32601`); cuando existan,
  heredan esta autorización (queda como requisito de P06).

## Criterio de cierre

1. Existe una entrada de catálogo por herramienta publicada, con `effectClass`
   de la lista cerrada, y un test de contrato que la compara con `annotations`.
2. Con la política en su valor por defecto, **toda** herramienta mutativa devuelve
   denegación y **cero efectos** en el cliente del producto.
3. `T-AUTHZ-01`, `T-RACE-01` y `T-INJECT-01` pasan y se ejecutan sobre el SHA
   declarado.
4. El journal registra intención, decisión y resultado con `correlationId`, sin
   valores secretos.
5. Los `annotations` de las herramientas que hoy están mal
   (`proton_calendar_create_event`, `proton_drive_copy`, `proton_pass_get`)
   quedan corregidos **por derivación del catálogo**.
6. `pnpm run lint`, `typecheck`, `test`, `test:contract`, `smoke` y `coverage`
   en verde, sin bajar los umbrales vigentes.

## Cuestiones abiertas que bloquean el arranque

1. **Identidad de actor**: ¿basta `sessionId` + identidad declarada, o se
   introducen tokens por actor antes de empezar?
2. **Corte del primer PR**: ¿se aprueba la recomendación de entregar
   `authz-catalog` + `authz-journal` primero, con la política en «denegar toda
   escritura», y dejar el canal de aprobación para el PR siguiente?
3. **Ubicación y permisos del spool** de aprobaciones.
4. **Granularidad**: ¿un grant por llamada o por plan con varios efectos?
