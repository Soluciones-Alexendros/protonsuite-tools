/**
 * Helpers de lectura de variables de entorno compartidos por los parsers de
 * configuración (src/config/*.ts).
 *
 * Cada sub-módulo define su schema + su parseXConfig(env); estos tres helpers
 * evitan repetir la lógica de "valor presente o default" en cada uno.
 */

export function readInt(value: string | undefined, defaultValue: number): number {
  return value !== undefined && value !== '' ? Number(value) : defaultValue
}

export function readBool(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  return value !== undefined && value !== '' ? value === 'true' : defaultValue
}

export function readCsv(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}
