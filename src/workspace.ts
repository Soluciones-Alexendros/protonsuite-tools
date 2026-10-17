/**
 * Política de workspace: dónde puede tocar el agente.
 *
 * El problema que resuelve (hallazgo F05): el cliente MCP podía mandar
 * `staging_dir` con cualquier ruta y el servidor la usaba tal cual para leer,
 * escribir y MOVER ficheros. Una ruta absoluta como `/etc` o un `../..` bastaban
 * para salirse del sitio previsto.
 *
 * Reglas:
 *  - Todo se resuelve dentro de una raíz fijada por el operador, nunca por el
 *    cliente.
 *  - Se rechaza lo absoluto que caiga fuera, el `..` que escape y el recorrido
 *    codificado (`%2e%2e`), porque un cliente puede mandarlo tal cual.
 *  - Se comprueba el camino REAL: un enlace simbólico que apunte fuera se
 *    rechaza, aunque su nombre parezca estar dentro.
 */
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

export type WorkspaceViolationCode =
  | 'empty-root'
  | 'nul-byte'
  | 'encoded-traversal'
  | 'absolute-outside'
  | 'traversal-outside'
  | 'symlink-escape'
  | 'not-a-directory';

export class WorkspaceViolation extends Error {
  constructor(
    message: string,
    public readonly code: WorkspaceViolationCode,
    public readonly candidate: string,
  ) {
    super(message);
    this.name = 'WorkspaceViolation';
  }
}

export interface WorkspaceOptions {
  /** Raíz concedida. Todo lo demás queda fuera. */
  readonly root: string;
}

export class WorkspacePolicy {
  /** Raíz tal cual, sin resolver enlaces. Se usa para dar mensajes legibles. */
  readonly root: string;
  /** Raíz con los enlaces resueltos. Es la que manda al decidir. */
  private readonly rootReal: string;

  constructor(opts: WorkspaceOptions) {
    if (opts.root.trim().length === 0) {
      throw new WorkspaceViolation('La raíz del workspace está vacía.', 'empty-root', '');
    }
    this.root = resolve(opts.root);
    // La raíz TAMBIÉN se canonicaliza: si apunta a un enlace, compararla sin
    // resolver haría que hasta su propia ruta pareciera estar fuera.
    this.rootReal = existsSync(this.root) ? realpathSync(this.root) : this.root;
  }

  /**
   * Resuelve una ruta y comprueba que cae dentro de la raíz.
   *
   * Lanza `WorkspaceViolation` si no. Devuelve el camino REAL cuando sí, para
   * que quien lo use trabaje sobre el mismo sitio que se ha validado.
   */
  resolveInside(candidate: string | undefined): string {
    const raw = candidate ?? '';
    if (raw.includes('\0')) {
      throw new WorkspaceViolation('La ruta contiene un byte nulo.', 'nul-byte', raw);
    }
    // Recorrido codificado: el cliente puede mandar `%2e%2e` tal cual.
    if (/%2e|%2f|%5c/i.test(raw)) {
      throw new WorkspaceViolation(
        `La ruta lleva recorrido codificado: ${raw}`,
        'encoded-traversal',
        raw,
      );
    }

    const nominal = isAbsolute(raw) ? normalize(raw) : resolve(this.root, raw);
    const real = this.realPathOfExistingPart(nominal);

    if (!this.inside(real)) {
      // Se distingue para poder dar un mensaje útil: ¿se salía ya de nombre, o
      // es un enlace el que lleva fuera?
      if (!this.insideNominal(nominal)) {
        throw new WorkspaceViolation(
          isAbsolute(raw)
            ? `Ruta absoluta fuera del workspace: ${raw}`
            : `La ruta se sale del workspace: ${raw}`,
          isAbsolute(raw) ? 'absolute-outside' : 'traversal-outside',
          raw,
        );
      }
      throw new WorkspaceViolation(
        `La ruta sale del workspace por un enlace simbólico: ${raw}`,
        'symlink-escape',
        raw,
      );
    }
    return real;
  }

  /** ¿Está dentro? Sin lanzar. Útil para comprobaciones y pruebas. */
  isInside(candidate: string | undefined): boolean {
    try {
      this.resolveInside(candidate);
      return true;
    } catch {
      return false;
    }
  }

  /** Comparación por tramos: `/datos-2` NO está dentro de `/datos`. */
  private inside(target: string): boolean {
    return contains(this.rootReal, target);
  }

  private insideNominal(target: string): boolean {
    return contains(this.root, target);
  }

  /**
   * Resuelve los tramos que YA existen y deja el resto sin tocar.
   *
   * Hace falta porque un destino puede no existir todavía (una carpeta por
   * crear) y `realpath` fallaría. Se sube hasta el primer tramo existente y se
   * resuelve ese.
   */
  private realPathOfExistingPart(target: string): string {
    let actual = target;
    const resto: string[] = [];
    while (!existsSync(actual)) {
      const padre = resolve(actual, '..');
      if (padre === actual) break;
      resto.unshift(actual.slice(padre.length + 1));
      actual = padre;
    }
    let real: string;
    try {
      real = realpathSync(actual);
    } catch {
      return target;
    }
    return resto.length > 0 ? join(real, ...resto) : real;
  }
}

/** Comparación por tramos, no por prefijo de texto. */
function contains(root: string, target: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith(sep) ? root : root + sep);
}
