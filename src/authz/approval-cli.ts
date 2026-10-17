/**
 * Comandos locales de aprobación.
 *
 * Están aquí, y no dentro de `agent-cli.ts`, para poder probarlos: el CLI es un
 * punto de entrada con efectos al importarse, así que su lógica vive aparte y
 * recibe las salidas por parámetro.
 *
 * Aprobar SOLO se puede desde este canal. No existe equivalente por MCP: si lo
 * hubiera, el modelo podría concederse permiso y la aprobación dejaría de ser un
 * control (ADR-0009).
 */
import type { ApprovalStore } from './approval-store.js';

export interface ApprovalCommandIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE: Record<string, string> = {
  pending: 'pending',
  approve: 'approve <id>',
  reject: 'reject <id>',
};

/**
 * Ejecuta un comando de aprobación. Devuelve el código de salida:
 * 0 correcto, 1 error de ejecución, 2 argumentos inválidos.
 */
export function runApprovalCommand(
  command: string,
  id: string | undefined,
  store: ApprovalStore,
  io: ApprovalCommandIo,
  who = 'unknown',
): number {
  if (!(command in USAGE)) {
    io.err(`[ERROR] comando desconocido: ${command}\n`);
    return 2;
  }

  if (!store.isAvailable()) {
    io.err('[ERROR] no se puede usar el almacén de aprobaciones\n');
    return 1;
  }

  if (command === 'pending') return listPending(store, io);

  if (!id) {
    io.err(`[ERROR] falta el identificador: ${command} <id>\n`);
    return 2;
  }

  try {
    if (command === 'approve') {
      const grant = store.approve(id, who);
      io.out(
        `Aprobada ${id} por ${grant.approvedBy}.\n` +
          'Repite ahora exactamente la misma llamada, con los mismos argumentos.\n',
      );
      return 0;
    }
    store.reject(id);
    io.out(`Denegada ${id}.\n`);
    return 0;
  } catch (err) {
    io.err(`[ERROR] ${(err as Error).message}\n`);
    return 1;
  }
}

function listPending(store: ApprovalStore, io: ApprovalCommandIo): number {
  const ids = store.pendingIds();
  if (ids.length === 0) {
    io.out('No hay operaciones esperando aprobación.\n');
    return 0;
  }

  io.out(`${ids.length} operación(es) esperando aprobación:\n\n`);
  for (const pid of ids) {
    const request = store.readPending(pid);
    if (!request) continue;
    io.out(`  ${pid}\n`);
    io.out(`    herramienta: ${request.toolId} (${request.effectClass})\n`);
    io.out(`    caduca:      ${request.expiresAt}\n`);
    if (Object.keys(request.preview).length > 0) {
      io.out(`    argumentos:  ${JSON.stringify(request.preview)}\n`);
    }
    io.out('\n');
  }
  io.out('Aprueba con: protonsuite-agent approve <id>\n');
  return 0;
}
