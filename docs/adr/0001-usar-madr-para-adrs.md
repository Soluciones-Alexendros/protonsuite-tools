# 0001. Usar MADR para Architecture Decision Records

- Estado: accepted
- Fecha: 2026-07 — revisado 2026-08-15
- Decisores: Alejandro · Soluciones Alexendros
- Etiquetas: documentación, gobernanza

> Texto en formato MADR 4.0.0 · https://adr.github.io/madr/

## Contexto y planteamiento del problema

El proyecto necesita registrar decisiones estructurales (transporte, puertos,
dry-run, Calendar, Drive) de forma estable, enlazable y revisable por agentes
y humanos. Un ADR suelto sin plantilla produce formatos inconsistentes; un
único `DECISIONS.md` monolítico (estilo otros repos) dificulta diffs y CI
parciales en un MCP con muchos dominios.

¿Qué fuerza la decisión?

- Ya existen ADRs 0002–0006 en `docs/adr/`.
- Se requiere plantilla reutilizable y estado explícito (accepted / superseded).
- La constitución del proyecto exige ADR ante cambios de seguridad o arquitectura.

Drivers:

- Trazabilidad ROADMAP → ADR.
- Diffs por decisión.
- Compatibilidad con agentes que leen un archivo por decisión.

## Opciones consideradas

- (opción A) ADRs MADR como archivos `docs/adr/NNNN-*.md`.
- (opción B) Un solo `DECISIONS.md` con `<details>`.
- (opción C) Solo issues/PRs de GitHub como registro.

## Resultado de la decisión

Opción elegida: **(opción A)**. Plantilla canónica: [`TEMPLATE.md`](./TEMPLATE.md).

### Consecuencias positivas

- Un archivo = una decisión; enlaces estables desde AGENTS/ARCHITECTURE.
- Formato homogéneo (estado, contexto, opciones, consecuencias).

### Consecuencias negativas

- Hay que mantener numeración y índice mental (mitigado por `docs/README.md`).

## Validación

Nuevos ADRs siguen MADR; ADR-0006 se normalizó al mismo formato (2026-08-15).

## Más información

- https://adr.github.io/madr/
- [CONSTITUTION.md](../../CONSTITUTION.md) §2
