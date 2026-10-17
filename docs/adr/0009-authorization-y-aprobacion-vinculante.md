# 0009. Autorización: catálogo de efectos en servidor y aprobación vinculante

- Estado: accepted
- Fecha: 2026-10-17 (aceptado el 2026-10-17)
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: seguridad, autorización, agentes
- Origen: `PST-PROD-CLOSE-2026-10-17` §1.3 (decisión obligatoria `ADR-AUTHZ`)
- Traza: hallazgo F03; objetivos `P02-O01`, `P06-O01`; tests `T-AUTHZ-01`, `T-INJECT-01`

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

El servidor expone hoy 50 herramientas, de las cuales **26 no son de lectura**:
15 con escritura y 9 destructivas. Ninguna exige autorización. El único freno es
`AGENT_DRY_RUN`, un booleano global, más el `dry_run` que cada herramienta
declara por su cuenta. Nada de eso es un control de autorización: es una
preferencia que se cambia con una variable de entorno.

¿Qué fuerza la decisión?

- **Las `annotations` no son fiables y no pueden ser la base del control.**
  Son un hint para el cliente, y hoy están equivocadas en varios casos:
  `proton_calendar_create_event` declara `readOnly: true` y crea eventos;
  `proton_drive_copy` declara `readOnly: true, idempotent: true` y copia
  ficheros; `proton_pass_get` no declara ni clase de lectura ni de escritura.
  Derivar autorización de ahí es derivarla de un campo que ya se sabe erróneo
  (hallazgo F43).
- **No hay identidad de actor.** El transporte HTTP usa un único bearer token
  compartido (`compareTokens` en `src/auth.ts`) y todo cliente es
  indistinguible. Sí existe un identificador de sesión (`randomUUID`) en
  `src/http.ts`.
- **El plan lo prohíbe explícitamente.** Regla 5: *las anotaciones MCP no
  sustituyen la autorización del servidor*. Regla 1: no operar sobre datos
  reales para reproducir vulnerabilidades.
- **La aprobación no puede vivir en el prompt.** Si el propio modelo pide
  permiso y se lo concede, no hay control: hay teatro. El canal de aprobación
  tiene que ser independiente del canal del modelo.

## Drivers de la decisión

- Denegar por defecto: lo que no está autorizado, no ocurre.
- Un único origen de verdad para los efectos, en el servidor.
- Independencia del modelo: el modelo nunca puede aprobar.
- Fallo cerrado: si falta el canal humano o la auditoría, la mutación no se
  habilita.
- Un consumo por aprobación, resistente a carrera y a replay.
- Sin reescribir el proyecto ni introducir una plataforma de políticas externa.

## Opciones consideradas

- (opción A) Mantener el estado: `annotations` + `AGENT_DRY_RUN`.
- (opción B) Catálogo de efectos en servidor, denegar por defecto y aprobación
  por canal humano local, con grant vinculante y consumo único.
- (opción C) Motor de políticas externo (OPA/Rego, Cedar o equivalente).
- (opción D) Confirmación declarada por el modelo dentro de la conversación.
- (opción E) Retirar sin más toda herramienta mutativa del catálogo MCP y
  dejar la escritura solo al CLI.

## Resultado de la decisión

Opción elegida: **"(opción B)"**.

### Lo que se decidió además (17/10/2026)

Dos cuestiones que el ADR no resolvía por sí solo:

**A quién se llama "actor" → identidad declarada, no verificada.**
El campo `actor` es un texto que escribe el operador en la configuración y que
queda registrado en el permiso y en la auditoría. Sirve para leer la traza
(«aprobó Alex»), **no para demostrar quién fue**. No es un control de seguridad:
quien tenga el token puede escribir el nombre que quiera. Queda escrito aquí
para que nadie lo confunda con atribución real. Los tokens por persona (que sí
serían verificables) se decidirán en su propio ADR, cuando HTTP deje de ser
monousuario; el perfil `HTTP-SINGLE` del ADR-0008 no los necesita.

**Cómo se entrega → todo el control junto, con aprobación mínima.**
Se implementan las cuatro capacidades en una sola entrega, pero la aprobación
se queda deliberadamente pequeña: un fichero con un identificador en un
directorio local, permisos restrictivos y consumo con creación exclusiva
(`wx`). Sin interfaz gráfica, sin servicio, sin canal de red. El motivo de no
partirlo: entregar antes el catálogo con la política en «denegar toda
escritura» congelaría el envío de correo y rompería los E2E a la vez que añade
el control, produciendo un PR que mezcla dos cosas opuestas.

Las cuestiones 3 (dónde vive el directorio de aprobaciones) y 4 (un permiso por
llamada o por plan con varios efectos) se resuelven en la implementación:
directorio configurable con valor por defecto local, y **un permiso por llamada**
(la aprobación por lote queda para cuando exista el concepto de plan aprobable).

### Catálogo de efectos (origen de verdad)

Cada herramienta declara, en el servidor, un `effectClass` de la lista cerrada
`read | write | destructive | admin`, más sus `scopes`, `resources` y política
de aprobación. El catálogo se define una sola vez y las `annotations` MCP se
**derivan** de él; nunca al revés. Corregir una anotación pasa a ser consecuencia
de corregir el catálogo.

Definiciones operativas:

- `read`: no cambia estado observable fuera del proceso.
- `write`: crea o modifica estado propio; repetible sin pérdida.
- `destructive`: puede perder, sobrescribir o exponer algo de forma
  irrecuperable (borrar, sobrescribir, compartir, instalar binario, autenticar
  como el operador).
- `admin`: cambia la configuración o las credenciales del propio agente.

### Política y denegación por defecto

La configuración del operador enumera las clases y scopes permitidos. Ausencia
de mención equivale a **denegado**. La decisión es determinista y se calcula
antes de tocar el cliente del producto: `PolicyDecision = allow | require_approval | deny`,
con motivo registrable.

### Canal de aprobación humano e independiente

La aprobación no viaja por MCP ni por el prompt. Se resuelve por un canal local
que el modelo no puede alcanzar:

- Una herramienta mutativa que requiere aprobación **crea una solicitud
  pendiente** (con su digest) y devuelve `require_approval` con el identificador.
  No ejecuta nada.
- El operador la ve y la concede desde el CLI local
  (`protonsuite-agent approve <request-id>`), que escribe el grant en un
  directorio local con permisos restrictivos.
- Si el canal no está disponible (sin TTY, sin directorio de aprobaciones), la
  mutación **queda deshabilitada**. No hay camino alternativo.

### Grant vinculante

Un grant solo autoriza **exactamente** lo que se aprobó. Se vincula a:

| Campo | Para qué |
|---|---|
| `planDigest` | sha256 del plan canónico (recursos, orden y argumentos) |
| `toolId` | la herramienta concreta |
| `actor` | quién ejecuta (ver *Cuestiones abiertas*) |
| `sessionId` | sesión MCP o ejecución CLI |
| `resources` | rutas/carpetas/UIDs afectados |
| `recipients` | destinatarios, cuando los haya |
| `contentDigest` | sha256 del cuerpo a enviar o subir |
| `issuedAt` / `expiresAt` | caducidad corta y explícita |
| `nonce` | unicidad del grant |

Cambiar cualquier campo invalidado — incluido cambiar un destinatario o un byte
del contenido — invalida el grant. **El consumption es atómico y único**: el
grant se reclama con una operación exclusiva (`O_EXCL` / `rename` atómico), de
modo que dos llamadas concurrentes no pueden consumir el mismo grant.

### Auditoría

Intención, decisión, efecto y resultado se registran con un `correlationId`, sin
valores secretos. Para las clases `destructive` y `admin`, la indisponibilidad
del sink de auditoría **bloquea antes del efecto** (fallo cerrado). Si el efecto
ya ocurrió y falla el recibo, se registra el efecto, nunca se finge que no pasó.

### Alcance de aplicación

El control se aplica en **todos** los puntos de entrada: herramientas MCP,
`agent-cli` y jobs. Si en el futuro existen `resources` o `prompts`, heredan la
misma autorización: leer un recurso no puede ser una vía alternativa para mutar.

### Consecuencias positivas

- La garantía deja de depender de la obediencia del modelo.
- Las anotaciones dejan de ser una fuente de verdad y se corrigen solas al
  derivarse del catálogo (cierra parte de F43).
- Un operador puede razonar sobre qué está autorizado sin leer los handlers.

### Consecuencias negativas

- Toda herramienta mutativa necesita un camino de aprobación explícito; añadir
  una nueva exige decidir su clase de efecto.
- Aparece un estado local nuevo (solicitudes y grants) con su propia política de
  permisos, retención y limpieza.
- La experiencia de uso se vuelve más pesada para escritura; el modo por defecto
  sigue siendo denegar.

## Pros y contras de las opciones

### (opción A) Estado actual

- Bueno, porque: cero trabajo.
- Malo, porque: el único freno es una variable de entorno y las anotaciones que
  el plan prohíbe usar como autorización son, además, incorrectas.

### (opción B) Catálogo en servidor + aprobación local (elegida)

- Bueno, porque: independiente del modelo, fallo cerrado y verificable con tests
  negativos.
- Malo, porque: añade estado local y exige que el operador interactúe para
  escribir.

### (opción C) Motor de políticas externo

- Bueno, porque: lenguaje de política maduro y auditable.
- Malo, porque: introduce un servicio y un lenguaje nuevos, contra la regla de
  no ampliar alcance sin necesidad demostrada. Reevaluable si la política crece.

### (opción D) Confirmación declarada por el modelo

- Bueno, porque: no requiere infraestructura.
- Malo, porque: es exactamente lo que la regla 5 del plan prohíbe. El modelo
  puede ser inducido por contenido no confiable a concederse permiso.

### (opción E) Retirar la escritura del MCP

- Bueno, porque: superficie mínima.
- Malo, porque: deja sin resolver la autorización del CLI y de los jobs, que es
  donde vive la escritura peligrosa (F01 y F02 estaban en el CLI).

## Validación

`T-AUTHZ-01`, `T-INJECT-01` y `T-RACE-01` del plan:

- Sin grant, cero efectos, en todas las clases mutativas y por todos los
  transportes.
- Grant alterado en cualquier campo vinculado → denegado.
- Grant caducado, ya consumido o de otra sesión → denegado.
- Dos llamadas concurrentes con un mismo grant → como máximo un efecto.
- Correo o documento hostil que intente inducir una mutación → denegado sin
  aprobación independiente.
- Cambio de política entre solicitud y consumo → denegado.
- Catálogo y `annotations` coherentes: test de contrato que falla si divergen.

## Cuestiones abiertas

1. ~~**Identidad de actor.**~~ Resuelta: identidad **declarada**, no verificada
   (ver *Lo que se decidió además*). No cuenta como control de seguridad.
2. ~~**Dónde vive el spool de aprobaciones.**~~ Resuelta: directorio
   configurable, por defecto local al operador.
3. ~~**Granularidad.**~~ Resuelta: un permiso por llamada.
4. **Interacción con `AGENT_DRY_RUN`**: ¿se mantiene como capa global encima, o
   se subsume en la política? Sigue abierta; hoy se mantiene.

## Más información

- Plan de cierre: `specs/production-close/scope.yaml`, `tasks/todo.md`.
- Alcance y perfiles: [ADR-0008](./0008-alcance-y-perfiles-soportados.md).
- Dry-run actual: [ADR-0004](./0004-config-validation-and-dry-run-guardrail.md).
- Evidencia de anotaciones incorrectas: `docs/api/mcp-tools.md` (Hints) frente a
  los handlers en `src/server/`.
