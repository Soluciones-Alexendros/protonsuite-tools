# P02-O01 — Motor de políticas y aprobación vinculante (especificación)

Estado: **aprobada el 17/10/2026** (identidad declarada + entrega completa con
aprobación mínima; ver ADR-0009).

Implementado y **conectado**: el control intercepta todas las herramientas MCP
desde un único punto en `buildServer`, y existe el comando local de aprobación.
Verificado de extremo a extremo en `tests/authz/guard-e2e.test.ts` (sin
aprobación no se ejecuta; aprobada desde fuera, sí; cambiar un argumento la
invalida; sin almacén, se deniega).

F03 queda cubierto en las herramientas MCP y en los objetivos del CLI. Los
trabajos internos que no pasen por ninguno de los dos siguen pendientes de
revisión.

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

## Decisiones tomadas

- **Identidad de actor:** declarada por el operador, **no verificada**. No es un
  control de seguridad; solo hace legible la auditoría.
- **Entrega:** las cuatro capacidades juntas, con aprobación mínima (fichero
  local + consumo exclusivo). Se descartó entregar antes el catálogo con la
  política en «denegar», porque congelaba el envío y rompía los E2E.
- **Directorio de aprobaciones:** configurable, por defecto local al operador.
- **Granularidad:** un permiso por llamada.

## Estado de las piezas

| Pieza | Estado |
|---|---|
| Catálogo de efectos (50 herramientas) | hecho |
| Política con denegación por defecto | hecho |
| Aprobaciones con consumo único | hecho |
| Auditoría con identificador de correlación | hecho |
| Conectado a las herramientas MCP | hecho |
| Conectado a los objetivos del CLI del agente | hecho |
| Comando local `approve` / `reject` / `pending` | hecho |
| `annotations` alineadas + test de contrato | hecho |
| Política explícita en todo test que construya el servidor | hecho |

Sobre los E2E: usan los adaptadores (`ImapClient`, `SmtpClient`) directamente, no
el servidor MCP, así que **la autorización no está en su camino**. No es un
agujero —esos tests no exponen ninguna superficie de decisión—, pero conviene
tenerlo escrito para que nadie crea que esos E2E validan el control. Lo que valida
el control son `guard.test.ts`, `guard-e2e.test.ts` y las pruebas del CLI.

El CLI usa el mismo motor, el mismo almacén y el mismo diario que el servidor
(`src/authz/runtime.ts`), y su sesión es estable entre ejecuciones (`cli:<host>`):
si fuera el pid, una aprobación no valdría para el intento siguiente.

Hallazgos corregidos de paso, encontrados por las propias pruebas:

- Tres `annotations` mentían: `proton_drive_copy` se declaraba de solo lectura y
  copia ficheros; `proton_drive_share` y `proton_drive_auth_login` se declaraban
  no destructivas y exponen contenido o cambian credenciales. Además
  `proton_calendar_create_event`, que se declaraba de lectura.
- El plan en seco de Drive (`dry_run: true`) pedía aprobación aunque no toca
  nada. Ahora el catálogo lo declara explícitamente herramienta a herramienta.
- `findClaimable` y `pendingIds` lanzaban si el almacén no se podía preparar, en
  vez de devolver «no hay nada». Un problema de entorno se convertía en un error
  opaco del protocolo.

---

## P02-O02 y P02-O03 (fase P02 completa)

**P02-O02 — auditoría durable y redacción (F42).** Lo que se corrigió:

- `audit()` era «best effort»: se lanzaba sin esperar y se tragaba el error. Si
  el disco estaba lleno, la operación se ejecutaba y no quedaba rastro. Ahora
  devuelve acuse, el fallo queda visible en el log y `flush()` drena al apagar.
- El logger **no redactaba nada**: `safeStringify` volcaba el objeto tal cual.
  La redacción vive ahora en el último punto común (el logger), así que quien
  loguee un secreto sin acordarse no abre un agujero. Cubre campos por nombre,
  anidamiento, listas, errores y credenciales embebidas en texto libre.
- El diario lleva `schemaVersion` en cada línea y rota por tamaño: un diario que
  crece sin freno acaba llenando el disco y provoca justo el fallo que debe
  evitar.

**P02-O03 — secretos fuera del modelo (F06).**

- `proton_bridge_login` ya no acepta `user`, `password` ni `totp` en el perfil
  por defecto. Lee las credenciales de su origen configurado y devuelve solo
  metadatos. El TOTP se puede resolver desde el almacén de secretos
  (`PROTON_BRIDGE_TOTP_PATH`) sin que pase por el modelo.
- `proton_pass_insert` se niega y explica cómo guardarlo desde el terminal, en
  lugar de desaparecer sin más.
- `SECRETS_FROM_MODEL=true` restaura el comportamiento antiguo. Está declarado y
  documentado como **no seguro**, no como una opción equivalente.

El snapshot del contrato deja constancia: en el perfil por defecto, los esquemas
publicados ya no tienen `secret`, `password` ni `totp`. El modelo no puede
enviarlos porque no existen en la superficie.
