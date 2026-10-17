# 0008. Alcance y perfiles soportados del cierre de producción

- Estado: accepted
- Fecha: 2026-10-17
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: alcance, seguridad, producto, release
- Origen: `specs/production-close/scope.yaml` (PST-PROD-CLOSE-2026-10-17)

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

El plan de cierre `PST-PROD-CLOSE-2026-10-17` exige congelar qué se soporta
antes de tocar código. Sin esa congelación, cada PR puede ampliar el alcance sin
que nadie lo note, y las guías acaban anunciando capacidades que no existen.

¿Qué fuerza la decisión?

- El registro **efectivo** de capacidades diverge de lo declarado. Medido en
  runtime sobre el baseline: 6 perfiles, entre **19 y 42** herramientas según
  configuración, y una unión de **50** nombres.
- Apagar un producto no apaga sus herramientas. Con
  `PROTON_MAIL_ENABLED=false` siguen registradas 14 herramientas de correo
  (`proton_send_email`, `proton_delete_email`, `proton_reply_email`, …). Con
  todos los productos apagados quedan 19 herramientas. Es el hallazgo F18.
- El servidor declara **una sola** capacidad: `tools`. `resources/*` y
  `prompts/*` responden `-32601` (método no encontrado). No hay resources ni
  prompts implementados: cero es un estado válido, pero debe declararse.
- Calendar depende de Bridge CalDAV y sigue bloqueado
  ([ADR-005](./0005-calendar-caldav-stub-proton-dependency.md)).
- Existe una SPA de ejemplo ([ADR-0007](./0007-spa-local-estatica.md)) que no
  controla el MCP y no debe convertirse en panel de producción por inercia.

## Drivers de la decisión

- No reescribir el proyecto, ni introducir monorepo o framework nuevos.
- El alcance por defecto es **local**: stdio, con HTTP monousuario tras proxy.
- Ninguna capacidad fuera de alcance puede anunciarse como operativa.
- Retirar una capacidad no borra su hallazgo: queda deshabilitada, inaccesible y
  con disposición aprobada.

## Opciones consideradas

- (opción A) Dejar el alcance implícito y documentarlo sobre la marcha.
- (opción B) Congelar perfiles con matriz de inclusión y gate de entrada.
- (opción C) Ampliar el alcance a servicio público multiusuario.

## Resultado de la decisión

Opción elegida: "(opción B)". Los perfiles quedan congelados así:

| Perfil | Estado | Gate de inclusión |
|---|---|---|
| LOCAL-READ | **incluido** | P01 + autorización + límites + E2E Bridge |
| HTTP-SINGLE | **incluido** | P04/P07 + pruebas de cliente + revocación |
| PASS-UNIX | **incluido** | E2E por backend (`pass` y `gopass`), sin falsa rotación |
| WEB-DEMO | **incluido como demo** | etiqueta demo persistente + pruebas UI |
| LOCAL-WRITE | **pendiente de ADR** | integridad y autoridad por operación |
| PASS-PROTON | **pendiente de ADR** | adaptador real de la CLI oficial + E2E propio |
| DRIVE | **pendiente de ADR** | ciclo real con hash y CLI fijada |
| CALENDAR | **excluido** | no hay backend; permanece no disponible |

Fuera de alcance del cierre: servicio público multiusuario, sincronización
bidireccional completa, rotación remota universal y panel web conectado a
producción. Cualquiera de ellos exige ADR y objetivos adicionales **antes** de
ampliar el alcance.

Plataformas y versiones soportadas en el cierre: Linux (x86_64) para runtime y
contenedor; Node ≥ 22; pnpm fijado por `packageManager`. macOS y Windows quedan
no soportados hasta que exista evidencia de E2E propia. La versión de producto
se deriva una sola vez y se propaga a `package.json`, `server.json` y runtime
(hallazgo F37); hoy divergen el README (1.4.0), `package.json` y `server.json`
(1.4.3).

### Consecuencias positivas

- Cada PR puede declarar qué perfil cierra y qué hallazgo toca.
- Las guías dejan de anunciar Calendar y Proton Pass oficial como operativos.
- El ledger gana un criterio objetivo: capacidad declarada == registro efectivo == documentación.

### Consecuencias negativas

- Hay que mantener la matriz de perfiles al añadir herramientas.
- Excluir Calendar obliga a retirarlo del marketing y de los quickstarts.
- PASS-PROTON, DRIVE y LOCAL-WRITE quedan bloqueados hasta su ADR, lo que
  retrasa su aceptación.

## Validación

`T-SCOPE-01` compara, por perfil, capacidades declaradas, registro efectivo y
documentación. Se ejecuta con:

```bash
pnpm build
node specs/production-close/probe-capabilities.mjs
```

El resultado queda en `specs/production-close/s00-baseline/capabilities-by-profile.json`.

Estado en el baseline: **no conforme** — F18 dejaba 14 herramientas de correo
registradas e invocables con `PROTON_MAIL_ENABLED=false`, y 19 con todos los
productos apagados, porque `registerMailTools` no consultaba el producto.

**Corregido.** `buildServer` registra cada grupo solo si su producto está
habilitado. Medido sobre la superficie real (`tools/list` por HTTP):

| Perfil | Antes | Ahora |
|---|---|---|
| Todo habilitado | 39 | 39 |
| `PROTON_MAIL_ENABLED=false` | 33 | 19 |
| Solo Pass | 27 | 13 |
| Solo Drive | 33 | 19 |
| Calendar experimental | 42 | 42 |
| Todos apagados | 19 | **5** |

Las 5 supervivientes son transversales y no dependen de producto:
`proton_suite_status` y `proton_ecosystem_*` (descubrimiento e instalación de
binarios Proton). La regresión se cubre en
`tests/contract/product-gating.test.ts`, que mide sobre `tools/list` real y no
cuenta nombres en el código fuente.

## Pros y contras de las opciones

### (opción A) Alcance implícito

- Bueno, porque: cero trabajo documental inmediato.
- Malo, porque: es la causa raíz de las contradicciones del hallazgo F44.

### (opción B) Perfiles congelados con gate (elegida)

- Bueno, porque: hace verificable "lo declarado es lo que hay" y acota cada PR.
- Malo, porque: exige disciplina para no ampliar perfiles sin ADR.

### (opción C) Servicio público multiusuario

- Bueno, porque: más superficie de producto.
- Malo, porque: introduce multitenancy, cuotas por identidad y aislamiento que
  hoy no existen; contradice la regla de no ampliar alcance sin ADR.

## Más información

- Evidencia: `specs/production-close/s00-baseline/capabilities-by-profile.json`.
- Alcance operativo: `specs/production-close/scope.yaml`.
- Ledger de hallazgos: `specs/production-close/findings.yaml`.
- Calendar: [ADR-005](./0005-calendar-caldav-stub-proton-dependency.md).
- SPA: [ADR-0007](./0007-spa-local-estatica.md).
