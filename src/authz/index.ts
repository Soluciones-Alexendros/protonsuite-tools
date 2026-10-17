/**
 * Autorización: catálogo de efectos, política, aprobaciones y auditoría.
 *
 * Ver ADR-0009 para la decisión completa y
 * `specs/production-close/specs/P02-O01-policy-engine.md` para el plan.
 */
export {
  EFFECT_CLASSES,
  hintsFor,
  isEffectClass,
  isMutating,
  type EffectClass,
} from './effect-class.js';

export {
  SCOPES,
  TOOL_EFFECTS,
  catalogedTools,
  effectClassOfTool,
  effectOf,
  type Scope,
  type ToolEffect,
} from './catalog.js';

export {
  DEFAULT_POLICY,
  decide,
  type AuthzPolicyConfig,
  type PolicyDecision,
  type PolicyInput,
  type PolicyResult,
} from './policy.js';

export {
  ApprovalStore,
  bindingOf,
  canonicalize,
  redactedPreview,
  type ApprovalRequest,
  type ClaimFailure,
  type ClaimResult,
  type Grant,
} from './approval-store.js';

export { Journal, type JournalEntry, type JournalOutcome } from './journal.js';
