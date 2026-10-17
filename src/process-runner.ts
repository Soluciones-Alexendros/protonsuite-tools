/**
 * Lanzador de procesos externos, con límites.
 *
 * Lo que había antes (hallazgos F24 y F25):
 *  - `execFile` sin timeout: un `pass` o `proton-drive` que se quedara colgado
 *    bloqueaba la operación para siempre.
 *  - `if (opts.input)`: una cadena VACÍA es falsy en JavaScript, así que ni se
 *    escribía ni se cerraba `stdin`. Cualquier comando que lea de la entrada
 *    —`pass insert --multiline`, por ejemplo— se quedaba esperando y no
 *    terminaba nunca.
 *  - Sin tope de salida: un proceso que escupa bytes sin parar llena la memoria.
 *
 * Reglas de aquí:
 *  - `stdin` SIEMPRE se cierra. Si no hay entrada, se cierra igual: mejor que el
 *    proceso reciba EOF y decida, que dejarlo esperando.
 *  - Todo proceso tiene deadline.
 *  - La salida está acotada.
 *  - Se distingue «salió mal» de «lo matamos nosotros»: no es lo mismo y quien
 *    llama necesita saberlo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Margen entre el SIGTERM y el SIGKILL para quien no atiende al primero. */
const KILL_GRACE_MS = 2_000;

export type ProcessFailure =
  | 'timeout'
  | 'output-limit'
  | 'spawn-error'
  | 'aborted'
  | 'non-zero-exit';

export interface RunProcessOptions {
  /** Ejecutable. Debe ser una ruta absoluta o un nombre simple, nunca una orden. */
  readonly file: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  /** Entrada estándar. La cadena vacía es válida y SÍ se escribe. */
  readonly input?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  /** Directorio de trabajo. */
  readonly cwd?: string;
}

export interface RunProcessResult {
  readonly ok: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Por qué falló. `undefined` cuando `ok` es `true`. */
  readonly failure?: ProcessFailure;
  /** Mensaje listo para mostrar; sin volcar la salida entera. */
  readonly message: string;
}

/**
 * Lanza un proceso y espera, con límites.
 *
 * No lanza excepciones por un fallo del comando: devuelve el resultado y quien
 * llama decide. Un `throw` aquí obligaría a cada llamante a envolverlo.
 */
export function runProcess(opts: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    let child: ChildProcess;
    try {
      child = spawn(opts.file, [...(opts.args ?? [])], {
        env: opts.env ?? process.env,
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        failure: 'spawn-error',
        message: `No se pudo lanzar ${opts.file}: ${(err as Error).message}`,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let acabado = false;
    let temporizador: NodeJS.Timeout | undefined;

    const terminar = (resultado: RunProcessResult): void => {
      if (acabado) return;
      acabado = true;
      if (temporizador) clearTimeout(temporizador);
      opts.signal?.removeEventListener('abort', alAbortar);
      resolve(resultado);
    };

    const matar = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ya no está */
      }
      // Si no atiende al SIGTERM, se insiste. Hay comandos que lo ignoran.
      const insistir = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ya no está */
        }
      }, KILL_GRACE_MS);
      insistir.unref();
    };

    function alAbortar(): void {
      matar();
      terminar({
        ok: false,
        code: null,
        stdout,
        stderr,
        failure: 'aborted',
        message: 'Operación cancelada.',
      });
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        alAbortar();
        return;
      }
      opts.signal.addEventListener('abort', alAbortar, { once: true });
    }

    const acumular = (destino: 'out' | 'err') => (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        matar();
        terminar({
          ok: false,
          code: null,
          stdout,
          stderr,
          failure: 'output-limit',
          message: `${opts.file} produjo más de ${maxBytes} bytes de salida.`,
        });
        return;
      }
      if (destino === 'out') stdout += chunk.toString();
      else stderr += chunk.toString();
    };

    child.stdout?.on('data', acumular('out'));
    child.stderr?.on('data', acumular('err'));

    child.on('error', (err) => {
      terminar({
        ok: false,
        code: null,
        stdout,
        stderr,
        failure: 'spawn-error',
        message: `No se pudo lanzar ${opts.file}: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        terminar({ ok: true, code: 0, stdout, stderr, message: '' });
        return;
      }
      terminar({
        ok: false,
        code,
        stdout,
        stderr,
        failure: 'non-zero-exit',
        message: stderr.trim() || `${opts.file} terminó con código ${String(code)}`,
      });
    });

    if (timeoutMs > 0) {
      temporizador = setTimeout(() => {
        matar();
        terminar({
          ok: false,
          code: null,
          stdout,
          stderr,
          failure: 'timeout',
          message: `${opts.file} superó el límite de ${timeoutMs} ms.`,
        });
      }, timeoutMs);
      temporizador.unref();
    }

    // `stdin` se cierra SIEMPRE. Escribir una cadena vacía es válido y hace
    // falta: con el `if (input)` de antes, ese caso dejaba al proceso esperando.
    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', () => {
        // EPIPE: el proceso terminó antes de que escribiéramos. No es un fallo
        // nuestro; el `close` de abajo dará el veredicto.
      });
      if (opts.input !== undefined) stdin.write(opts.input);
      stdin.end();
    }
  });
}

/** ¿Es un ejecutable utilizable? Ruta absoluta o nombre simple, nunca una orden. */
export function looksLikeExecutable(file: string): boolean {
  if (file.trim().length === 0) return false;
  if (isAbsolute(file)) return true;
  // Un nombre simple con separadores o espacios apunta a una orden, no a un binario.
  return /^[A-Za-z0-9._-]+$/.test(file);
}
