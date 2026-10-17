/**
 * Registro de auditoría de autorización.
 *
 * Anota cada intento con un identificador de correlación: qué se pidió, qué
 * decidió la política y cómo acabó. NUNCA escribe valores de secretos.
 *
 * Drena y espera cada escritura: si el registro falla, quien llama lo sabe. No
 * se inventa un «éxito» cuando el recibo no se pudo escribir.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EffectClass } from './effect-class.js';
import type { PolicyDecision } from './policy.js';

export type JournalOutcome = 'allowed' | 'pending-approval' | 'denied' | 'approved' | 'failed';

export interface JournalEntry {
  readonly correlationId: string;
  readonly toolId: string;
  readonly effectClass: EffectClass;
  readonly decision: PolicyDecision;
  readonly outcome: JournalOutcome;
  readonly actor: string;
  readonly sessionId: string;
  readonly reason: string;
  /** Identificador de la solicitud de aprobación, cuando la hay. */
  readonly approvalId?: string;
}

export interface JournalOptions {
  /** Ruta del fichero JSONL. Si es `null`, el registro es un no-op. */
  readonly file: string | null;
  readonly now?: () => Date;
}

export class Journal {
  private readonly file: string | null;
  private readonly now: () => Date;

  constructor(opts: JournalOptions) {
    this.file = opts.file;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Escribe una entrada. Devuelve `false` si no se pudo registrar, para que
   * quien llama pueda fallar cerrado cuando la operación lo exige.
   */
  write(entry: JournalEntry): boolean {
    if (this.file === null) return true;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      appendFileSync(
        this.file,
        `${JSON.stringify({ at: this.now().toISOString(), ...entry })}\n`,
        { mode: 0o600 },
      );
      return true;
    } catch {
      return false;
    }
  }
}
