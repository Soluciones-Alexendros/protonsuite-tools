# 0007. SPA local estática: landing y panel de estado

- Estado: accepted
- Fecha: 2026-09-24
- Decisores: Alejandro · Iniciativas Alexendros
- Etiquetas: arquitectura, ui, seguridad

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

El [ROADMAP](../../ROADMAP.md) excluye un dashboard web (alertas, operación
remota). Aun así hace falta una superficie legible: qué es el agente, qué hace
y qué no hace, sin arrancar Bridge ni el proceso MCP.

¿Qué fuerza la decisión?

- `stdout` del transporte stdio es JSON-RPC. Una UI dentro de ese proceso lo
  rompe.
- Pass no devuelve valores y el correo no debe salir de la máquina
  ([SECURITY.md](../../SECURITY.md)).
- Calendar sigue bloqueado en Bridge ([ADR-005](./0005-calendar-caldav-stub-proton-dependency.md)).
- La interfaz tiene que abrirse con el build estático, sin red y sin secretos.

## Drivers de la decisión

- Una sola SPA, estática, en `apps/web`.
- Sin Bridge embebido, sin login y sin CalDAV.
- Dry-run: la UI no muta; como mucho muestra un plan de ejemplo.
- Paquete aparte del servidor MCP.

## Opciones consideradas

- (opción A) Seguir sin ninguna superficie web.
- (opción B) Una SPA Vite estática (landing + panel de estado) separada del MCP.
- (opción C) Montar la UI dentro del servidor HTTP del agente.
- (opción D) Un dashboard de alertas con datos reales.

## Resultado de la decisión

Opción elegida: "(opción B)", porque informa y enseña el estado con datos de
ejemplo sin convertir el agente en un servicio web ni reabrir el dashboard que
el roadmap excluye.

La SPA cubre, en este orden, cabecera, propuesta, características,
funcionalidades, roadmap y cierre. El panel (ruta `#panel`) muestra estado de
suite, un plan dry-run de ejemplo y salud de ecosistema. El adaptador por
defecto está etiquetado «datos de ejemplo». No hay endpoint obligatorio.

### Consecuencias positivas

- La landing y el panel se abren sin MCP y sin Bridge.
- El binario y el stdio no cambian.
- Calendar permanece stub. Esta SPA no implementa CalDAV.

### Consecuencias negativas

- Los datos de ejemplo pueden confundirse con un estado real. El rótulo
  «datos de ejemplo» es obligatorio en el panel.
- Hay un paquete más en el workspace (`apps/web`), solo de build estático.

## Validación

- `pnpm --filter @alexendros/protonsuite-web run build` genera tokens, pasa el
  contraste (≥ 4.5:1 texto, ≥ 3:1 UI, claro y oscuro) y emite `apps/web/dist`.
- `make validate` sigue cubriendo lint, tests, build y smoke del agente.
- Abrir `apps/web/dist/index.html` no pide credenciales ni llama a la red.

## Pros y contras de las opciones

### (opción A) Sin superficie web

- Bueno, porque: cero superficie nueva.
- Malo, porque: el producto solo se entiende leyendo el README.

### (opción B) SPA estática aparte (elegida)

- Bueno, porque: landing y panel locales, sin secretos y sin tocar stdout.
- Malo, porque: no refleja el Bridge real hasta que exista un adaptador, y ese
  adaptador no forma parte de esta decisión.

### (opción C) UI dentro del proceso HTTP

- Bueno, porque: un solo puerto.
- Malo, porque: mezcla presentación con el servidor MCP y acerca secretos a la UI.

### (opción D) Dashboard de alertas

- Bueno, porque: operación en vivo.
- Malo, porque: el roadmap lo excluye y exigiría datos reales del buzón.

## Más información

- Código: `apps/web/`. Contrato visual: `apps/web/tokens/CONTRACT.md` (v1.0).
- Calendar: [ADR-005](./0005-calendar-caldav-stub-proton-dependency.md).
- Dry-run del agente: [ADR-004](./0004-config-validation-and-dry-run-guardrail.md).
