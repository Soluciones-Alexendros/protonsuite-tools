# 0005. Calendar CalDAV stub — dependencia de Proton Bridge

- Estado: accepted (blocking)
- Fecha: 2026-06 — alineado con `PROTON_CALENDAR_ENABLED`
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: arquitectura, calendario, caldav, blocking

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

Proton Calendar usa sincronización E2E cifrada con un protocolo propietario y, de
momento, **Proton Mail Bridge no expone CalDAV**. No existe acceso CalDAV de
terceros a los eventos/carpetas de Proton Calendar. Por tanto, una
implementación CalDAV contra Proton no es posible hoy sin violar el modelo E2E
o sin el soporte oficial de Bridge.

¿Qué fuerza la decisión?

- El threat model (SECURITY.md T1–T9) sitúa Bridge como la única frontera
  criptográfica; nada aguas abajo debe intentar descifrar ni acceder E2E.
- Las tools de Calendar registradas en `src/server/calendar.ts` devuelven
  `{available: false}` con un mensaje que explica el limite.
- `.env.example` documenta que `PROTON_CALENDAR_ENABLED` es `false` ("not yet
  available").

Drivers de la decisión:

- Preservar la E2E de Proton al máximo.
- No implementar contra una API que no existe (evitar código muerto / falsos
  positivos de disponibilidad).
- Mantener la puerta abierta: cuando Bridge soporte CalDAV, el stub se reemplaza
  por un adaptador real con el mismo puerto.

## Opciones consideradas

- (opción A) Implementar CalDAV apuntando al Bridge actual (imposible).
- (opción B) Stub tipado que registre tools y devuelva `{available: false}`.
- (opción C) No registrar Calendar en absoluto.

## Resultado de la decisión

Opción elegida: "(opción B)", porque documenta el contrato (tools esperadas)
sin prometer funcionalidad que el backend no ofrece, y deja el puerto listo para
un futuro adaptador real.

### Consecuencias positivas

- Los clientes MCP que enumeran `tools/list` ven las tools de Calendar y reciben
  un error claro y accionable en vez de un `tool not found`.
- El puerto (`ICalendarAdapter`, por añadir en `src/clients/interfaces.ts`) puede
  definirse ahora; el stub es el adaptador por defecto.
- `docs/adr/0005` registra explícitamente que el bloqueo es upstream (Proton),
  no un descuido del equipo.

### Consecuencias negativas

- Los usuarios pueden esperar funciones de calendario que no están disponibles.
- Hay que mantener sincronizado el stub con la realidad de Proton (commit
  `37a48be` alineó los mensajes del stub con la realidad de Bridge).

## Pros y contras de las opciones

### (opción A) Implementar CalDAV contra Bridge hoy

- Bueno, porque: funcionalidad completa.
- Malo, porque: imposible — Bridge no expone CalDAV; cualquier intento imita E2E.

### (opción B) Stub tipado (elegida)

- Bueno, porque: contrato documentado; error claro; puerto listo.
- Malo, porque: funcionalidad limitada; requiere actualización cuando Proton actúe.

### (opción C) No registrar Calendar

- Bueno, porque: cero código muerto.
- Malo, porque: clientes no descubren que Calendar existe; mala DX.

## Cómo validar el desbloqueo

El bloqueo se levanta cuando Proton Mail Bridge exponga CalDAV (RFC 4791 /
RFC 5545). Hasta entonces:

- El stub permanece; `PROTON_CALENDAR_ENABLED` sigue `false`.
- Para pruebas del futuro adaptador, apuntar contra un servidor CalDAV estándar
  (Radicale/Nextcloud) bajo `tests/` con feature flag, nunca a Proton directamente.

## Más información

- Stub: `src/server/calendar.ts` (`registerCalendarTools`).
- Threat model: `SECURITY.md` §6 y T1–T9.
- Documentado en `.env.example` y `ARCHITECTURE.md` §1.
