/**
 * Decisión de autorización.
 *
 * Responde una sola pregunta: ¿esta herramienta puede ejecutarse ahora, sin
 * más, necesita una aprobación humana, o se deniega?
 *
 * Tres reglas que no se negocian:
 *  1. Denegar por defecto. Lo que el operador no autoriza, no ocurre.
 *  2. Una herramienta que no está en el catálogo se deniega. Así, olvidarse de
 *     declararla la bloquea en vez de dejarla pasar.
 *  3. La decisión no lee `annotations` ni nada que venga del cliente.
 */
import { effectOf, type ToolEffect } from './catalog.js';
import { isMutating, type EffectClass } from './effect-class.js';

export type PolicyDecision = 'allow' | 'require_approval' | 'deny';

export interface AuthzPolicyConfig {
  /**
   * `enforce` aplica la decisión; `observe` solo la registra y deja pasar.
   * `observe` existe para medir antes de bloquear y NO debe usarse en un perfil
   * con datos reales: no protege de nada.
   */
  readonly mode: 'enforce' | 'observe';
  /** Clases que se ejecutan sin aprobación. Por defecto solo `read`. */
  readonly allow: readonly EffectClass[];
  /** Clases que exigen aprobación humana. Por defecto las tres mutativas. */
  readonly requireApproval: readonly EffectClass[];
}

export const DEFAULT_POLICY: AuthzPolicyConfig = {
  mode: 'enforce',
  allow: ['read'],
  requireApproval: ['write', 'destructive', 'admin'],
};

export interface PolicyInput {
  readonly toolId: string;
  /** Texto del operador (config). No es una identidad verificada; ver ADR-0009. */
  readonly actor: string;
  /** Sesión MCP o ejecución del CLI. Es lo que impide reutilizar una aprobación. */
  readonly sessionId: string;
  /** Argumentos de la llamada. Solo se usan para reglas declaradas en el catálogo. */
  readonly args?: unknown;
}

export interface PolicyResult {
  readonly decision: PolicyDecision;
  readonly reason: string;
  readonly effect?: ToolEffect;
}

export function decide(
  input: PolicyInput,
  policy: AuthzPolicyConfig = DEFAULT_POLICY,
): PolicyResult {
  const effect = effectOf(input.toolId);
  if (!effect) {
    return {
      decision: 'deny',
      reason: `Herramienta fuera del catálogo de efectos: ${input.toolId}`,
    };
  }

  const effectiveClass = effectiveClassOf(effect, input.args);

  if (!isMutating(effectiveClass)) {
    return {
      decision: 'allow',
      reason:
        effectiveClass === effect.effectClass
          ? 'Solo lectura.'
          : 'Solo lectura: la llamada va en seco (dry_run).',
      effect,
    };
  }

  // De aquí hacia abajo, la herramienta puede cambiar algo.
  if (policy.allow.includes(effectiveClass)) {
    return {
      decision: 'allow',
      reason: `El operador autoriza la clase ${effectiveClass}.`,
      effect,
    };
  }

  if (policy.requireApproval.includes(effectiveClass)) {
    return {
      decision: 'require_approval',
      reason: `La clase ${effectiveClass} exige aprobación humana.`,
      effect,
    };
  }

  return {
    decision: 'deny',
    reason: `La clase ${effectiveClass} no está autorizada para este perfil.`,
    effect,
  };
}

/**
 * Clase efectiva de una llamada concreta.
 *
 * Hoy la única excepción declarada es `dry_run: true` en las herramientas que
 * lo piden: no tocan nada, así que se tratan como lectura. No se adivina por el
 * nombre del argumento: hay que declararlo en el catálogo.
 */
function effectiveClassOf(effect: ToolEffect, args: unknown): EffectClass {
  if (effect.readonlyWhenDryRun !== true) return effect.effectClass;
  const dryRun = (args as { dry_run?: unknown } | undefined)?.dry_run;
  return dryRun === true ? 'read' : effect.effectClass;
}
