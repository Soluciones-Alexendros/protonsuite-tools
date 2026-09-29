# 0003. Extracción de puertos y adaptadores (Ports & Adapters / Hexagonal)

- Estado: accepted
- Fecha: 2026-07 — revisado 2026-08-15 (split `src/server/*` cerrado)
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: arquitectura, separación-de-capas, testabilidad

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

Las tools MCP y el agente autónomo necesitan operar Mail, Pass, Drive y
Calendar, pero no deben atarse a una implementación concreta (IMAP vs futuro
API, `pass` vs `gopass`, `proton-drive` CLI vs futura API REST). Además, los
tests unitarios deben poder inyectar dobles de prueba sin `vi.mock` de
`execFile`/`imapflow`. La solución clásica es el patrón **Ports & Adapters**
(Hexagonal): los consumidores dependen de **interfaces** (puertos), y las
implementaciones concretas (adaptadores) se inyectan por el contenedor
(`buildServer`).

¿Qué fuerza la decisión?

- Antes del split, las implementaciones (`ImapClient`) se importaban
  directamente desde un `server.ts` monolítico, dificultando el mock.
- El layout actual usa `src/clients/interfaces.ts`
  (`IImapClient`, `ISmtpClient`, `IDriveClient`, `IPassClient`,
  `ICalendarAdapter`) y `src/server/*.ts` con inyección vía `deps`.
- El split está **cerrado** (2026-08); la cobertura debe mantenerse ≥98%.

Drivers de la decisión:

- Testabilidad (inyección de dobles sin mocks globales).
- Extensibilidad (añadir `gopass` u una API REST no toca consumidores).
- Documentación del contrato (la interfaz describe el módulo completo).
- Inversión de dependencias (los consumidores no conocen la implementación).

## Opciones consideradas

- (opción A) Inyectar implementaciones concretas (`ImapClient`) y mockear en tests.
- (opción B) Puerto (interfaz) + inyección; adaptadores concretos en el contenedor.
- (opción C) Patrón DDD completo (entidades/repositorios) sobre cada producto.

## Resultado de la decisión

Opción elegida: "(opción B)", porque da la separación justa (contrato vs
implementación) sin el sobre-ingeniería de (opción C) y mantiene la estructura
plana y probada del código.

### Consecuencias positivas

- `src/clients/interfaces.ts` es la única referencia del contrato de cada
  adaptador; los consumidores (`src/server/*.ts`, `src/agent/*`) dependen de él.
- Los tests pasan dobles simples (obj `{} as IImapClient`) en vez de `vi.mock`.
- `pass` → `gopass` solo requiere un nuevo adaptador que implemente `IPassClient`.
- La cobertura de los adaptadores (`src/imap.ts`, `src/drive.ts`, etc.) se
  mantiene porque la lógica de negocio vive en `src/server/*.ts` sobre los
  puertos.

### Consecuencias negativas

- Los adaptadores concretos siguen viviendo en `src/` (no en `src/adapters/`),
  para no forzar un rename que romperia el 98% de cobertura y los imports
  existentes. La separación lógica (interfaz vs implementación) es suficiente.
- `src/drive.ts` usa un estilo `{ ok: boolean; error?: string }` en lugar de
  `Result<T,E>` monádico; ver ADR-004.

## Pros y contras de las opciones

### (opción A) Inyectar implementaciones concretas

- Bueno, porque: menos archivos.
- Malo, porque: tests atados a `imapflow`/`nodemailer`; difícil cambiar backend.

### (opción B) Puerto + adaptador (elegida)

- Bueno, porque: inversión de dependencias; tests limpios; doble inercial.
- Malo, porque: 4 interfaces extra que hay que mantener sincronizadas con los adaptadores.

### (opción C) DDD completo

- Bueno, porque: máxima explícitud del dominio.
- Malo, porque: sobre-ingeniería para un MCP server; la lógica de dominio es
  poca (organización/clasificación) y no justifica entidades/repositorios.

## Más información

- Interfaces: `src/clients/interfaces.ts`.
- Implementaciones: `src/imap.ts`, `src/smtp.ts`, `src/pass.ts`, `src/drive.ts`.
- Contenedor: `buildServer` en `src/server.ts`.
- Configuración de productos (feature gating): `src/config.ts` +
  `src/config/{bridge,pass,drive,calendar}.ts`.
