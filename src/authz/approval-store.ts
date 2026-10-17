/**
 * Solicitudes de aprobación y permisos de un solo uso.
 *
 * Idea: cuando una herramienta mutativa quiere ejecutarse, NO ejecuta. Deja una
 * solicitud en un directorio local y espera. El operador la aprueba desde su
 * terminal, fuera del modelo. El permiso queda atado a lo exacto que se aprobó
 * y se puede gastar UNA vez.
 *
 * Qué se guarda en disco, y qué no:
 *  - Se guarda la HUELLA (sha256) de los argumentos, no los argumentos.
 *  - Se guarda una vista previa con los campos sensibles tachados.
 *  - Nunca se guarda un secreto en claro.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { EffectClass } from './effect-class.js';

const SENSITIVE_KEY = /pass|secret|token|totp|credential|apikey|api_key/i;

export interface ApprovalRequest {
  readonly id: string;
  readonly toolId: string;
  readonly effectClass: EffectClass;
  readonly scopes: readonly string[];
  readonly actor: string;
  readonly sessionId: string;
  /** sha256 de la herramienta + argumentos. Es lo que ata la aprobación. */
  readonly binding: string;
  /** Vista previa con los campos sensibles tachados. */
  readonly preview: Record<string, unknown>;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface Grant {
  readonly id: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export type ClaimFailure =
  | 'unknown-request'
  | 'not-approved'
  | 'rejected'
  | 'expired'
  | 'session-mismatch'
  | 'actor-mismatch'
  | 'binding-mismatch'
  | 'already-consumed'
  | 'store-unavailable';

export type ClaimResult = { ok: true } | { ok: false; reason: ClaimFailure };

export interface ApprovalStoreOptions {
  /** Directorio raíz del almacén de aprobaciones. */
  readonly dir: string;
  /** Cuánto vale una solicitud (y su permiso) desde que se crea. */
  readonly ttlMs?: number;
  readonly now?: () => Date;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Serializa un valor de forma estable: las claves se ordenan antes de
 * convertirlo a texto. Sin esto, dos llamadas con los mismos datos podrían dar
 * huellas distintas solo por el orden de las claves y la aprobación no casaría.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

/** Huella de lo que se autoriza: herramienta + argumentos, en orden estable. */
export function bindingOf(toolId: string, args: unknown): string {
  return createHash('sha256').update(canonicalize({ toolId, args })).digest('hex');
}

/** Copia de los argumentos con los campos sensibles tachados. */
export function redactedPreview(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redactado]' : value;
  }
  return out;
}

export interface CreateRequestInput {
  readonly toolId: string;
  readonly effectClass: EffectClass;
  readonly scopes: readonly string[];
  readonly actor: string;
  readonly sessionId: string;
  readonly args: unknown;
}

export class ApprovalStore {
  private readonly dir: string;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(opts: ApprovalStoreOptions) {
    this.dir = opts.dir;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? (() => new Date());
  }

  private path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  private ensureDirs(): void {
    for (const sub of ['pending', 'granted', 'rejected', 'consumed']) {
      mkdirSync(this.path(sub), { recursive: true, mode: 0o700 });
    }
  }

  /** ¿Se puede usar el almacén? Si no, la política debe fallar cerrada. */
  isAvailable(): boolean {
    try {
      this.ensureDirs();
      return true;
    } catch {
      return false;
    }
  }

  createRequest(input: CreateRequestInput): ApprovalRequest {
    this.ensureDirs();
    const now = this.now();
    const id = randomUUID();
    const request: ApprovalRequest = {
      id,
      toolId: input.toolId,
      effectClass: input.effectClass,
      scopes: input.scopes,
      actor: input.actor,
      sessionId: input.sessionId,
      binding: bindingOf(input.toolId, input.args),
      preview: redactedPreview(input.args),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
    };
    this.writeJson(this.path('pending', `${id}.json`), request);
    return request;
  }

  /** El operador concede el permiso. Solo desde un canal local, nunca por MCP. */
  approve(id: string, approvedBy: string): Grant {
    this.ensureDirs();
    const request = this.readRequest('pending', id);
    if (!request) throw new Error(`Solicitud desconocida: ${id}`);
    const grant: Grant = {
      id,
      approvedBy,
      approvedAt: this.now().toISOString(),
    };
    this.writeJson(this.path('granted', `${id}.json`), grant);
    return grant;
  }

  /** El operador deniega la solicitud. */
  reject(id: string): void {
    this.ensureDirs();
    const from = this.path('pending', `${id}.json`);
    if (!existsSync(from)) throw new Error(`Solicitud desconocida: ${id}`);
    renameSync(from, this.path('rejected', `${id}.json`));
  }

  /**
   * Consume el permiso. Devuelve `ok: true` como MUCHO a un llamante.
   *
   * El orden importa: primero se comprueba todo, y el paso que decide quién
   * gana es crear el fichero de consumo en modo exclusivo (`wx`). Si dos
   * llamadas llegan a la vez, una crea el fichero y la otra recibe EEXIST. No
   * hay ventana entre «comprobar» y «gastar».
   *
   * Se gasta ANTES de ejecutar. Si luego la ejecución falla, el permiso ya está
   * quemado: es lo seguro. Preferimos que el operador apruebe otra vez a que un
   * permiso se use dos veces.
   */
  claim(
    id: string,
    input: { toolId: string; args: unknown; actor: string; sessionId: string },
  ): ClaimResult {
    if (!this.isAvailable()) return { ok: false, reason: 'store-unavailable' };

    if (existsSync(this.path('rejected', `${id}.json`))) {
      return { ok: false, reason: 'rejected' };
    }
    const request = this.readRequest('pending', id);
    if (!request) return { ok: false, reason: 'unknown-request' };

    const grant = this.readRequest('granted', id);
    if (!grant) return { ok: false, reason: 'not-approved' };

    const now = this.now();
    if (now.getTime() > Date.parse(request.expiresAt)) {
      return { ok: false, reason: 'expired' };
    }
    if (request.sessionId !== input.sessionId) {
      return { ok: false, reason: 'session-mismatch' };
    }
    if (request.actor !== input.actor) {
      return { ok: false, reason: 'actor-mismatch' };
    }
    if (request.binding !== bindingOf(input.toolId, input.args)) {
      return { ok: false, reason: 'binding-mismatch' };
    }

    // El paso decisivo: creación exclusiva.
    const consumedPath = this.path('consumed', id);
    let fd: number;
    try {
      fd = openSync(consumedPath, 'wx', 0o600);
    } catch {
      return { ok: false, reason: 'already-consumed' };
    }
    try {
      writeFileSync(
        fd,
        JSON.stringify({ id, consumedAt: now.toISOString(), actor: input.actor }),
      );
    } finally {
      closeSync(fd);
    }
    return { ok: true };
  }

  /**
   * Busca una aprobación viva que encaje EXACTAMENTE con esta llamada.
   *
   * Se empareja por la huella de los argumentos, no por un identificador que
   * mande el cliente: así el cliente no puede elegir qué aprobación usar, y
   * cambiar cualquier argumento rompe el encaje.
   *
   * Devuelve la solicitud más reciente que cumpla todo, o `null`.
   */
  findClaimable(binding: string, actor: string, sessionId: string): string | null {
    // Defensivo: si el almacén no se puede ni preparar, no hay nada que
    // encontrar. Lanzar aquí convertiría un problema de entorno en un error
    // opaco del protocolo.
    try {
      this.ensureDirs();
    } catch {
      return null;
    }
    const now = this.now().getTime();
    let candidate: { id: string; createdAt: number } | null = null;

    let granted: string[] = [];
    try {
      granted = readdirSync(this.path('granted'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
    } catch {
      return null;
    }

    for (const id of granted) {
      if (existsSync(this.path('consumed', id))) continue;
      const request = this.readRequest('pending', id);
      if (!request) continue;
      if (request.binding !== binding) continue;
      if (request.actor !== actor) continue;
      if (request.sessionId !== sessionId) continue;
      if (now > Date.parse(request.expiresAt)) continue;

      const createdAt = Date.parse(request.createdAt);
      if (candidate === null || createdAt > candidate.createdAt) {
        candidate = { id, createdAt };
      }
    }

    return candidate?.id ?? null;
  }

  pendingIds(): string[] {
    // Igual que `findClaimable`: listar no debe lanzar por un problema de
    // entorno. Se devuelve vacío y quien decide avisa.
    try {
      this.ensureDirs();
      return readdirSync(this.path('pending'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
    } catch {
      return [];
    }
  }

  readPending(id: string): ApprovalRequest | null {
    return this.readRequest('pending', id);
  }

  private readRequest(
    sub: 'pending' | 'granted',
    id: string,
  ): (ApprovalRequest & Partial<Grant>) | null {
    try {
      return JSON.parse(
        readFileSync(this.path(sub, `${id}.json`), 'utf8'),
      ) as ApprovalRequest & Partial<Grant>;
    } catch {
      return null;
    }
  }

  private writeJson(target: string, value: unknown): void {
    writeFileSync(target, JSON.stringify(value, null, 2), { mode: 0o600 });
  }
}
