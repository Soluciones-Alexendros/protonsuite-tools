/**
 * Catálogo de efectos por herramienta.
 *
 * Es el ORIGEN DE VERDAD de la autorización: una entrada escrita a mano por
 * cada herramienta publicada, con la clase de efecto, el ámbito que toca y una
 * frase que justifica la clase. Las `annotations` MCP se derivan de aquí.
 *
 * Si una herramienta no aparece en este catálogo, la política la DENIEGA. Añadir
 * una herramienta nueva sin declarar su efecto no la deja pasar: la bloquea.
 */
import type { EffectClass } from './effect-class.js';

/** Qué toca la herramienta. Se usa para vincular la aprobación y para auditar. */
export const SCOPES = [
  'mailbox',
  'password-store',
  'secrets',
  'calendar',
  'drive-staging',
  'drive-remote',
  'bridge',
  'host',
] as const;

export type Scope = (typeof SCOPES)[number];

export interface ToolEffect {
  readonly effectClass: EffectClass;
  readonly scopes: readonly Scope[];
  /** Por qué esa clase, en una frase. Se revisa en cada PR que toque la tool. */
  readonly reason: string;
  /**
   * La herramienta solo mira cuando `dry_run` es exactamente `true`. Se declara
   * aquí, una por una, en vez de adivinarlo: pedir aprobación para un plan en
   * seco sería ruido, pero dar por hecho que cualquiera con `dry_run` no toca
   * nada sería un agujero.
   */
  readonly readonlyWhenDryRun?: true;
}

const read = (scopes: readonly Scope[], reason: string): ToolEffect => ({
  effectClass: 'read',
  scopes,
  reason,
});
const write = (scopes: readonly Scope[], reason: string): ToolEffect => ({
  effectClass: 'write',
  scopes,
  reason,
});
const destructive = (
  scopes: readonly Scope[],
  reason: string,
): ToolEffect => ({ effectClass: 'destructive', scopes, reason });
const admin = (scopes: readonly Scope[], reason: string): ToolEffect => ({
  effectClass: 'admin',
  scopes,
  reason,
});

export const TOOL_EFFECTS: Readonly<Record<string, ToolEffect>> = {
  // ── Mail ────────────────────────────────────────────────────────────────
  proton_list_folders: read(['mailbox'], 'Lista carpetas; no cambia estado.'),
  proton_mailbox_status: read(['mailbox'], 'Cuenta mensajes; no cambia estado.'),
  proton_list_emails: read(['mailbox'], 'Lee el buzón sin modificarlo.'),
  proton_search_emails: read(['mailbox'], 'Busca en el buzón sin modificarlo.'),
  proton_get_email: read(['mailbox'], 'Lee un mensaje concreto.'),
  proton_get_attachment: read(['mailbox'], 'Descarga un adjunto en memoria.'),
  proton_create_folder: write(['mailbox'], 'Crea una carpeta; repetible sin pérdida.'),
  proton_flag_email: write(['mailbox'], 'Cambia flags (leído, marcado); reversible.'),
  proton_move_email: write(['mailbox'], 'Mueve entre carpetas; reversible a mano.'),
  proton_send_email: write(
    ['mailbox'],
    'Entrega un correo: efecto hacia fuera, no repetible sin duplicar.',
  ),
  proton_reply_email: write(['mailbox'], 'Responde: entrega hacia fuera.'),
  proton_forward_email: write(['mailbox'], 'Reenvía: entrega hacia fuera.'),
  proton_delete_email: destructive(
    ['mailbox'],
    'Borra un mensaje; sin vuelta atrás desde el agente.',
  ),

  // ── Agente ──────────────────────────────────────────────────────────────
  proton_agent_plan: read(['mailbox'], 'Solo lee el buzón y propone un plan.'),

  // ── Pass ────────────────────────────────────────────────────────────────
  proton_pass_list: read(['password-store'], 'Nombres de entradas; nunca valores.'),
  proton_pass_health: read(['password-store'], 'Comprueba acceso al almacén.'),
  proton_pass_get: read(
    ['password-store', 'secrets'],
    'Lee un secreto: no cambia estado, pero expone material sensible.',
  ),
  proton_pass_insert: destructive(
    ['password-store'],
    'Escribe o sobrescribe una entrada del almacén.',
  ),
  proton_pass_generate: destructive(
    ['password-store'],
    'Genera y escribe; con overwrite reemplaza una credencial existente.',
  ),
  proton_pass_remove: destructive(['password-store'], 'Borra una entrada del almacén.'),
  proton_pass_move: write(['password-store'], 'Renombra una entrada; recuperable.'),
  proton_pass_copy: write(['password-store'], 'Duplica una entrada; no pierde datos.'),

  // ── Calendar ────────────────────────────────────────────────────────────
  proton_calendar_list_calendars: read(['calendar'], 'Lista calendarios.'),
  proton_calendar_list_events: read(['calendar'], 'Lista eventos.'),
  proton_calendar_create_event: write(
    ['calendar'],
    'Crea un evento. Declaraba readOnly:true y escribe (F43).',
  ),

  // ── Drive ───────────────────────────────────────────────────────────────
  proton_drive_status: read(['drive-remote'], 'Consulta estado del cliente.'),
  proton_drive_audit: read(['drive-staging'], 'Inventaría el staging local.'),
  proton_drive_format_report: read(['drive-staging'], 'Analiza formatos del staging.'),
  proton_drive_list_files: read(['drive-remote'], 'Lista ficheros remotos.'),
  proton_drive_auth_status: read(['drive-remote'], 'Solo consulta la sesión de auth.'),
  proton_drive_download: write(['drive-staging'], 'Escribe ficheros en el staging local.'),
  proton_drive_upload: write(['drive-remote'], 'Sube ficheros a Proton Drive.'),
  proton_drive_create_folder: write(['drive-remote'], 'Crea una carpeta remota.'),
  proton_drive_move: write(['drive-remote'], 'Mueve ficheros remotos; reversible.'),
  proton_drive_copy: write(
    ['drive-remote'],
    'Copia ficheros. Declaraba readOnly:true y escribe (F43).',
  ),
  proton_drive_organize: {
    effectClass: 'destructive',
    scopes: ['drive-staging'],
    reason: 'Mueve masivamente el staging; con colisión puede perder ficheros (F02).',
    readonlyWhenDryRun: true,
  },
  proton_drive_remove: destructive(['drive-remote'], 'Borra ficheros remotos.'),
  proton_drive_share: destructive(
    ['drive-remote'],
    'Comparte contenido: lo expone fuera del operador y no se deshace solo.',
  ),
  proton_drive_auth_login: admin(
    ['drive-remote', 'host'],
    'Abre sesión del cliente y persiste credenciales en el keychain.',
  ),

  // ── Suite ───────────────────────────────────────────────────────────────
  proton_suite_status: read([], 'Reporta qué productos están habilitados.'),

  // ── Ecosystem ───────────────────────────────────────────────────────────
  proton_ecosystem_discover: read([], 'Detecta binarios instalados.'),
  proton_ecosystem_health: read([], 'Comprueba que los binarios responden.'),
  proton_ecosystem_check_updates: read([], 'Consulta versiones disponibles.'),
  proton_ecosystem_install: destructive(
    ['host'],
    'Instala binarios en el sistema del operador.',
  ),

  // ── Bridge ──────────────────────────────────────────────────────────────
  proton_bridge_health: read(['bridge'], 'Comprueba puertos y proceso.'),
  proton_bridge_status: read(['bridge'], 'Combina estado y salud.'),
  proton_bridge_info: read(['bridge'], 'Lee usuario, versión y puertos.'),
  proton_bridge_accounts: read(['bridge'], 'Lista cuentas configuradas.'),
  proton_bridge_login: admin(
    ['bridge'],
    'Autentica en el Bridge con las credenciales principales.',
  ),
  proton_bridge_logout: admin(['bridge'], 'Cierra la sesión del Bridge.'),

  // ── Objetivos del CLI del agente ────────────────────────────────────────
  //
  // No son herramientas MCP, pero se ejecutan desde la misma máquina y escriben
  // igual. Se declaran aquí para que el mismo control los cubra: si no
  // estuvieran, el CLI sería una vía para mutar sin autorización.
  //
  // Se marcan `readonlyWhenDryRun` porque el CLI respeta `AGENT_DRY_RUN`: si el
  // operador no ha desactivado el modo seco, el objetivo no toca nada.
  'agent:discover': read(['mailbox'], 'Comprueba el buzón; no cambia nada.'),
  'agent:setup': read(['bridge'], 'Verifica conectividad; no cambia nada.'),
  'agent:check-imap': read(['mailbox'], 'Comprueba IMAP; no cambia nada.'),
  'agent:monitor': read(['mailbox'], 'Solo inspecciona.'),
  'agent:alert': read(['mailbox'], 'Solo inspecciona y avisa.'),
  'agent:pass-audit': read(
    ['password-store'],
    'Audita el almacén de secretos; es de solo lectura por diseño (F01).',
  ),
  'agent:suite-status': read([], 'Reporta estado; no cambia nada.'),
  'agent:suite-manage': read([], 'Descubre binarios; no instala.'),
  'agent:drive-audit': read(['drive-staging'], 'Inventaría el staging.'),
  'agent:drive-list': read(['drive-remote'], 'Lista ficheros remotos.'),
  'agent:organize': {
    effectClass: 'write',
    scopes: ['mailbox'],
    reason: 'Mueve correo a carpetas según las reglas del agente.',
    readonlyWhenDryRun: true,
  },
  'agent:drive-organize': {
    effectClass: 'destructive',
    scopes: ['drive-staging'],
    reason: 'Mueve masivamente el staging; con colisión puede perder ficheros (F02).',
    readonlyWhenDryRun: true,
  },
  'agent:drive-download': {
    effectClass: 'write',
    scopes: ['drive-staging'],
    reason: 'Escribe ficheros en el staging local.',
    readonlyWhenDryRun: true,
  },
  'agent:drive-upload': {
    effectClass: 'write',
    scopes: ['drive-remote'],
    reason: 'Sube ficheros a Proton Drive.',
    readonlyWhenDryRun: true,
  },
};

/** Efecto declarado de una herramienta, o `undefined` si no está en el catálogo. */
export function effectOf(toolId: string): ToolEffect | undefined {
  return TOOL_EFFECTS[toolId];
}

export function effectClassOfTool(toolId: string): EffectClass | undefined {
  return TOOL_EFFECTS[toolId]?.effectClass;
}

/** Nombres de todas las herramientas declaradas. */
export function catalogedTools(): string[] {
  return Object.keys(TOOL_EFFECTS).sort();
}
