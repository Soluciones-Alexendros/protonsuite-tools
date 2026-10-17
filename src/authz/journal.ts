/**
 * Registro de auditoría de autorización.
 *
 * Anota cada intento con un identificador de correlación: qué se pidió, qué
 * decidió la política y cómo acabó. NUNCA escribe valores de secretos.
 *
 * Drena y espera cada escritura: si el registro falla, quien llama lo sabe. No
 * se inventa un «éxito» cuando el recibo no se pudo escribir.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { EffectClass } from './effect-class.js';
import type { PolicyDecision } from './policy.js';

export type JournalOutcome = 'allowed' | 'pending-approval' | 'denied' | 'approved' | 'failed';

/**
 * Versión del esquema de cada línea del diario.
 *
 * Va escrita en cada entrada para que quien lea un diario viejo pueda
 * interpretarlo sin adivinar. Si cambia la forma, sube aquí.
 */
export const JOURNAL_SCHEMA_VERSION = 1;

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
  /**
   * Tamaño máximo antes de rotar. `0` o ausente desactiva la rotación.
   *
   * Sin rotación, un diario que crece sin freno acaba llenando el disco y
   * PROVOCA el fallo de auditoría que este mecanismo existe para evitar.
   */
  readonly maxBytes?: number;
  /** Cuántos ficheros rotados se conservan. Por defecto 5. */
  readonly keep?: number;
  readonly now?: () => Date;
}

export class Journal {
  private readonly file: string | null;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly now: () => Date;

  constructor(opts: JournalOptions) {
    this.file = opts.file;
    this.maxBytes = opts.maxBytes ?? 0;
    this.keep = opts.keep ?? 5;
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
      this.rotateIfNeeded();
      appendFileSync(
        this.file,
        `${JSON.stringify({ schemaVersion: JOURNAL_SCHEMA_VERSION, at: this.now().toISOString(), ...entry })}\n`,
        { mode: 0o600 },
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Rota el diario si pasó del tamaño máximo, conservando `keep` copias. */
  private rotateIfNeeded(): void {
    if (this.maxBytes <= 0 || this.file === null) return;
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return; // Todavía no existe: nada que rotar.
    }
    if (size < this.maxBytes) return;

    try {
      // Se renumera de mayor a menor para no pisar la copia anterior.
      rmSync(`${this.file}.${this.keep}`, { force: true });
      for (let i = this.keep - 1; i >= 1; i--) {
        const from = `${this.file}.${i}`;
        if (existsSync(from)) renameSync(from, `${this.file}.${i + 1}`);
      }
      renameSync(this.file, `${this.file}.1`);
    } catch {
      // Si la rotación falla se sigue escribiendo donde estábamos, en vez de
      // perder la entrada.
    }
  }
}
