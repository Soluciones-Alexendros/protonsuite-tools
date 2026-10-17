/**
 * Interceptor de herramientas: aquí es donde el motor de políticas pasa de ser
 * código a ser un control.
 *
 * Envuelve el manejador de una herramienta. Antes de ejecutarlo decide si
 * puede, si necesita aprobación humana o si se deniega. La decisión NO mira los
 * `annotations` ni nada que venga del cliente.
 *
 * Cómo se aprueba algo, en dos pasos:
 *  1. La llamada no se ejecuta. Se crea una solicitud y se devuelve su
 *     identificador. El cliente ya sabe qué hacer: es un error explícito.
 *  2. El operador aprueba desde su terminal, fuera del modelo. Cuando el cliente
 *     repite EXACTAMENTE la misma llamada, el interceptor encuentra la solicitud
 *     aprobada que encaja con esos argumentos, gasta el permiso y ejecuta.
 *
 * No hace falta pasar ningún identificador en los argumentos: se empareja por la
 * huella de lo que se pidió. Así el cliente no puede «elegir» qué aprobación
 * usar, y cambiar cualquier argumento rompe el emparejamiento.
 */
import { randomUUID } from 'node:crypto';
import { bindingOf, type ApprovalStore } from './approval-store.js';
import type { EffectClass } from './effect-class.js';
import type { Journal } from './journal.js';
import { decide, type AuthzPolicyConfig } from './policy.js';

export type ToolHandler = (...args: unknown[]) => Promise<unknown>;

export interface GuardDeps {
  readonly policy: AuthzPolicyConfig;
  readonly store: ApprovalStore;
  readonly journal: Journal;
  /** Identidad declarada del operador. No es verificada; ver ADR-0009. */
  readonly actor: string;
  readonly log: {
    debug: (message: string, data?: unknown) => void;
    warn: (message: string, data?: unknown) => void;
  };
}

/** Respuesta MCP de denegación. La operación NO se ha ejecutado. */
function denied(reason: string): unknown {
  return {
    isError: true,
    content: [{ type: 'text', text: `Denegado: ${reason}` }],
    structuredContent: { status: 'denied', reason },
  };
}

/** Respuesta MCP cuando hace falta que un humano apruebe. Nada se ejecutó. */
function approvalRequired(input: {
  id: string;
  effectClass: EffectClass;
  reason: string;
  scopes: readonly string[];
}): unknown {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: [
          'No se ha ejecutado nada: esta operación necesita aprobación humana.',
          `Solicitud: ${input.id}`,
          `Efecto: ${input.effectClass} — ${input.reason}`,
          `Ámbitos: ${input.scopes.join(', ') || 'ninguno'}`,
          '',
          `Aprueba desde tu terminal con: protonsuite-agent approve ${input.id}`,
          'Después repite exactamente esta misma llamada, con los mismos argumentos.',
        ].join('\n'),
      },
    ],
    structuredContent: {
      status: 'approval_required',
      approvalId: input.id,
      effectClass: input.effectClass,
      scopes: input.scopes,
    },
  };
}

/**
 * Envuelve un manejador con la comprobación de autorización.
 *
 * Falla cerrado: si no se puede consultar el almacén de aprobaciones o no se
 * puede registrar una operación destructiva, se deniega.
 */
export function guardTool(
  toolId: string,
  handler: ToolHandler,
  deps: GuardDeps,
): ToolHandler {
  return async (...callArgs: unknown[]): Promise<unknown> => {
    const args = callArgs[0];
    const extra = (callArgs[1] ?? {}) as { sessionId?: string };
    // En stdio y en el CLI no hay sesión de transporte: se usa el proceso.
    const sessionId = extra.sessionId ?? `local:${process.pid}`;
    const correlationId = randomUUID();

    const decision = decide(
      { toolId, actor: deps.actor, sessionId, args },
      deps.policy,
    );
    const effectClass: EffectClass = decision.effect?.effectClass ?? 'admin';

    if (decision.decision === 'deny') {
      deps.journal.write({
        correlationId,
        toolId,
        effectClass,
        decision: 'deny',
        outcome: 'denied',
        actor: deps.actor,
        sessionId,
        reason: decision.reason,
      });
      deps.log.warn('authz denied', { tool: toolId, reason: decision.reason });
      return denied(decision.reason);
    }

    if (decision.decision === 'allow') {
      deps.journal.write({
        correlationId,
        toolId,
        effectClass,
        decision: 'allow',
        outcome: 'allowed',
        actor: deps.actor,
        sessionId,
        reason: decision.reason,
      });
      return handler(...callArgs);
    }

    // A partir de aquí, la herramienta muta y necesita aprobación.
    if (deps.policy.mode === 'observe') {
      deps.log.warn('authz observe: se ejecuta sin bloquear', {
        tool: toolId,
        reason: decision.reason,
      });
      return handler(...callArgs);
    }

    // Fallo cerrado: sin almacén no hay forma de comprobar la aprobación.
    if (!deps.store.isAvailable()) {
      const reason = 'El almacén de aprobaciones no está disponible.';
      deps.journal.write({
        correlationId,
        toolId,
        effectClass,
        decision: 'require_approval',
        outcome: 'denied',
        actor: deps.actor,
        sessionId,
        reason,
      });
      return denied(reason);
    }

    const scopes = decision.effect?.scopes ?? [];
    const binding = bindingOf(toolId, args);

    // ¿Hay ya una aprobación viva para exactamente esta llamada?
    const approvedId = deps.store.findClaimable(binding, deps.actor, sessionId);
    if (approvedId !== null) {
      const claim = deps.store.claim(approvedId, {
        toolId,
        args,
        actor: deps.actor,
        sessionId,
      });
      if (claim.ok) {
        deps.journal.write({
          correlationId,
          toolId,
          effectClass,
          decision: 'require_approval',
          outcome: 'approved',
          actor: deps.actor,
          sessionId,
          reason: 'Aprobación consumida.',
          approvalId: approvedId,
        });
        return handler(...callArgs);
      }
      deps.log.warn('authz claim rechazado', { tool: toolId, reason: claim.reason });
      return denied(`La aprobación no se pudo consumir (${claim.reason}).`);
    }

    // No hay aprobación: se pide una y no se ejecuta nada.
    const request = deps.store.createRequest({
      toolId,
      effectClass,
      scopes,
      actor: deps.actor,
      sessionId,
      args,
    });

    const registered = deps.journal.write({
      correlationId,
      toolId,
      effectClass,
      decision: 'require_approval',
      outcome: 'pending-approval',
      actor: deps.actor,
      sessionId,
      reason: decision.reason,
      approvalId: request.id,
    });
    // Para lo destructivo y lo administrativo, sin registro no se sigue.
    if (!registered && (effectClass === 'destructive' || effectClass === 'admin')) {
      return denied(
        'No se pudo registrar la solicitud en la auditoría; la operación queda bloqueada.',
      );
    }

    return approvalRequired({
      id: request.id,
      effectClass,
      reason: decision.reason,
      scopes,
    });
  };
}
