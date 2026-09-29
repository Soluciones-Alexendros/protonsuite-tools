# 0004. Validación de config al arranque y fail-closed con dry-run

- Estado: accepted
- Fecha: 2026-01 — reforzado 2026-07
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: arquitectura, configuración, seguridad, operacional

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

El servidor arranca en dos modos (`stdio` local, `http` remoto) y controla hasta
4 productos (Mail, Pass, Calendar, Drive) cuyos bins/creds pueden no estar
presentes. Si la configuración es inválida (falta `PROTON_BRIDGE_USER`, puerto
fuera de rango, origin allowlist vacío en producción…), el proceso debe **morir
al arranque** con un mensaje legible en `stderr`, no explotar a mitad de una
request ni (peor) arrancar en un estado degradado que filtre datos. Asimismo, el
agente autónomo nunca debe aplicar cambios destructivos por accidente: el
dry-run es el valor por defecto.

¿Qué fuerza la decisión?

- Variables de entorno son el único canal de configuración; no hay archivo de
  config. Si algo falta, el error aparece en runtime a mitad de una llamada
  MCP — difícil de diagnosticar y potencialmente peligroso (p.ej. SMTP relay
  mal configurado, amenaza T3).
- El agente autónomo (`src/agent/executor.ts`) mueve/flags/borra emails. Un
  dry-run desactivado por accidente ejecutaría cambios sobre el buzón real.
- `stdout` está reservado al JSON-RPC en `stdio`; los errores deben viajar por
  `stderr` y terminar el proceso (exit 2 para config, 1 para runtime) para que
  el orquestador (Docker/systemd) lo reinicie limpio.

Drivers de la decisión:

- Fail-fast / fail-closed: error de config → exit 2.
- Seguridad operativa: dry-run por defecto (`AGENT_DRY_RUN=true`).
- Diagnóstico claro: mensaje en `stderr` apuntando a `.env.example`.
- Separación de infinito: `http` exige `MCP_AUTH_TOKEN` y, en producción,
  `MCP_ALLOWED_ORIGINS` no vacío.

## Opciones consideradas

- (opción A) Validar pereza (primer uso) y lanzar en runtime.
- (opción B) Validar todo al arranque con Zod (`loadConfig`); diez exit 2 si falla.
- (opción C) Schema de config perdida, confiar en defaults silentes.

## Resultado de la decisión

Opción elegida: "(opción B)", con fail-closed extra para HTTP en producción.

### Consecuencias positivas

- `loadConfig()` en `src/config.ts` valida con `ConfigSchema` (composición de
  sub-schemas `src/config/{bridge,pass,drive,calendar}.ts`) y `.parse()` lanza
  al arranque; `src/index.ts` atrapa el error y escribe a `stderr` con exit 2.
- Cada producto tiene `enabled` (gate); productos deshabilitados no se inicializan
  y sus tools no se registran.
- `AGENT_DRY_RUN` (default `true`) es la única forma de autorizar mutaciones en el
  agente; `src/agent/executor.ts` respeta el flag.
- En HTTP producción, `MCP_ALLOWED_ORIGINS` vacío aborta el arranque (fail-closed
  contra DNS rebinding T2).

### Consecuencias negativas

- Un error de config tumba el proceso: es intencional (fail-fast), pero exige
  documentación clara de los variables requeridos (`.env.example`).
- El gate `enabled` significa que un producto "olvidado" en `false` no registra
  tools; esto es el comportamiento deseado (fail-safe) pero puede confundir en
  despliegues parciales.

## Pros y contras de las opciones

### (opción A) Validación pereza

- Bueno, porque: arranca incluso con config incompleta (modo degraded).
- Malo, porque: fallos aparecen en runtime, difíciles de diagnosticar; riesgo de
  relay SMTP o auth bypass degradado.

### (opción B) Validación al arranque (elegida)

- Bueno, porque: fail-fast, error claro, fail-closed en producción.
- Malo, porque: arranque más lento (Zod sobre todo el env) — insignificante.

### (opción C) Defaults silentos

- Bueno, porque: nunca falla al arranque.
- Malo, porque: comportamiento implícito; fácil operar contra el Bridge equivocado.

## Validación

- `tests/config.test.ts` ejerce `loadConfig` con env válidos/inválidos.
- `tests/http-transport.test.ts` verifica fail-closed: HTTP production sin
  `MCP_ALLOWED_ORIGINS` no arranca.
- CI (`ci.yml`) ejecuta `pnpm run typecheck` que incluye el schema.

## Más información

- Implementación: `src/config.ts` (`ConfigSchema`, `loadConfig`, `createLogger`).
- Sub-schemas: `src/config/{bridge,pass,drive,calendar}.ts`.
- Dry-run: `src/agent/executor.ts` respeta `cfg.agent.dryRun`.
- `.env.example` documenta cada variable; `.env.test.example` para tests.
