/**
 * Clases de efecto.
 *
 * Una clase describe QUÉ puede pasarle al mundo si una herramienta se ejecuta.
 * Es la base de la decisión de autorización: el servidor decide por clase, no
 * por lo que el cliente declare en las `annotations` (que hoy están mal en
 * varios casos; ver ADR-0009).
 */
export const EFFECT_CLASSES = ['read', 'write', 'destructive', 'admin'] as const;

export type EffectClass = (typeof EFFECT_CLASSES)[number];

/**
 * `read`        — no cambia nada fuera del proceso.
 * `write`       — crea o modifica estado; repetirlo no destruye nada.
 * `destructive` — puede perder, sobrescribir o exponer algo sin vuelta atrás.
 * `admin`       — cambia la configuración o las credenciales del propio agente.
 */
export function isEffectClass(value: string): value is EffectClass {
  return (EFFECT_CLASSES as readonly string[]).includes(value);
}

/** ¿La clase puede alterar algo? Si no, no hace falta autorización. */
export function isMutating(effectClass: EffectClass): boolean {
  return effectClass !== 'read';
}

/**
 * Hints MCP que se DERIVAN de la clase.
 *
 * La dirección importa: el catálogo manda y las anotaciones se calculan. Si se
 * hiciera al revés, estaríamos autorizando a partir de un campo que el cliente
 * ve y que ya hemos comprobado que está equivocado.
 */
export function hintsFor(effectClass: EffectClass): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
} {
  return {
    readOnlyHint: effectClass === 'read',
    destructiveHint: effectClass === 'destructive' || effectClass === 'admin',
  };
}
