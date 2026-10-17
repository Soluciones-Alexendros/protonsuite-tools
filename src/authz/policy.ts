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

  if (!isMutating(effect.effectClass)) {
    return { decision: 'allow', reason: 'Solo lectura.', effect };
  }

  // De aquí hacia abajo, la herramienta puede cambiar algo.
  if (policy.allow.includes(effect.effectClass)) {
    return {
      decision: 'allow',
      reason: `El operador autoriza la clase ${effect.effectClass}.`,
      effect,
    };
  }

  if (policy.requireApproval.includes(effect.effectClass)) {
    return {
      decision: 'require_approval',
      reason: `La clase ${effect.effectClass} exige aprobación humana.`,
      effect,
    };
  }

  return {
    decision: 'deny',
    reason: `La clase ${effect.effectClass} no está autorizada para este perfil.`,
    effect,
  };
}
