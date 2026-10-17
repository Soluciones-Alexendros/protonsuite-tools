/**
 * Montaje del motor de autorización a partir de la configuración.
 *
 * Existe para que el servidor MCP y el CLI del agente usen EXACTAMENTE el mismo
 * motor, el mismo almacén de aprobaciones y el mismo diario. Si cada uno
 * montara el suyo, una aprobación concedida en uno no valdría en el otro y el
 * CLI podría quedar fuera del control.
 */
import { ApprovalStore } from './approval-store.js';
import type { EffectClass } from './effect-class.js';
import { Journal } from './journal.js';
import type { AuthzPolicyConfig } from './policy.js';

export interface AuthzSettings {
  readonly mode: 'enforce' | 'observe';
  readonly actor: string;
  readonly approvalDir: string;
  readonly journalFile: string | null;
  readonly allow: readonly EffectClass[];
  readonly requireApproval: readonly EffectClass[];
}

/**
 * Valores por defecto del motor. Son los SEGUROS: si falta configuración, se
 * aplica la política y se exige aprobación para escribir. Nunca al revés.
 */
export const DEFAULT_AUTHZ_SETTINGS: AuthzSettings = {
  mode: 'enforce',
  actor: 'operator',
  approvalDir: '.protonsuite/approvals',
  journalFile: 'logs/authz.jsonl',
  allow: ['read'],
  requireApproval: ['write', 'destructive', 'admin'],
};

export interface AuthzRuntime {
  readonly policy: AuthzPolicyConfig;
  readonly store: ApprovalStore;
  readonly journal: Journal;
  readonly actor: string;
}

export interface AuthzRuntimeDeps {
  readonly store?: ApprovalStore;
  readonly journal?: Journal;
}

export function buildAuthzRuntime(
  settings: AuthzSettings | undefined,
  deps: AuthzRuntimeDeps = {},
): AuthzRuntime {
  const s = settings ?? DEFAULT_AUTHZ_SETTINGS;
  return {
    policy: { mode: s.mode, allow: s.allow, requireApproval: s.requireApproval },
    store: deps.store ?? new ApprovalStore({ dir: s.approvalDir }),
    journal: deps.journal ?? new Journal({ file: s.journalFile }),
    actor: s.actor,
  };
}
