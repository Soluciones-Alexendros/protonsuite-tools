# Contrato de tokens DTCG OKLCH

### Propósito de este documento

- **Objetivos:** Fijar el contrato visual v1 de la SPA local: nombres, modos y puerta de contraste.
- **Estructura:** Versión → hojas → build → prohibiciones → pares medidos.
- **Contenido a integrar según contexto:** Paleta de protonsuite. No reutilices colores de otro producto.

Abrir cuando: Cambias color, tipo o spacing de `apps/web`.
Aprobado: 24 de septiembre de 2026
Audiencia: Agente, Dirección
Autoridad: Operativa
Clase: Obligatorio
Días para revisión: 90
En repo: Sí
Estado: Aprobado
Orden: 1
Propósito: Contrato DTCG OKLCH v1 de la SPA estática.
Reforma: Operativa
Responsable: Alexendros
Revisión: 23 de diciembre de 2026
Rol: Contrato
Ruta: ./apps/web/tokens/CONTRACT.md

**Versión:** 1.0

## Hojas

| Fichero | Qué cubre |
| --- | --- |
| `primitive.color.tokens.json` | `brand`, `neutral`, `success`, `warning`, `danger`, `focus` en OKLCH |
| `semantic.color.tokens.json` | `bg`, `text`, `border`, `action`, `feedback` con `light` y `dark` |
| `primitive.dimension.tokens.json` | `space`, `radius`, `shadow`, `motion`, `z`, `breakpoint` |
| `semantic.typography.tokens.json` | Familia, peso, tamaño, interlineado |
| `component.alias.tokens.json` | Alias `button`, `card`, `input` |

Cada hoja declara `$meta.version` `"1.0"`.

## Build

`node scripts/build-tokens.mjs` (Node puro, sin dependencias) escribe variables CSS y un JSON resuelto por modo. El hex sRGB solo aparece en `dist-tokens/json/fallback-hex.json` y en el bloque `@supports` del CSS generado, para el gate y para navegadores sin `oklch()`.

La UI en `src/` consume `var(--*)`. No pinta con hex ni con `oklch()` sueltos.

## Contraste

`node scripts/check-contrast.mjs` exige, en claro y en oscuro:

- texto sobre fondo: **≥ 4.5:1**
- UI y bordes: **≥ 3:1**

`prefers-reduced-motion`, `lang="es"`, landmarks y foco visible viven en la SPA, no en estas hojas.
