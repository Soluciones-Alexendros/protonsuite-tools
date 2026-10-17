import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { BridgeClient } from '../bridge/bridge-client.js'
import type { createLogger } from '../config.js'
import { asStructured } from './structured-content.js'

type Logger = ReturnType<typeof createLogger>

type RegisterFn = typeof McpServer.prototype.registerTool

/**
 * Campos PÚBLICOS de Bridge que pueden salir hacia el modelo.
 *
 * El límite MCP no confía en el DTO del cliente: construye el payload por
 * lista positiva, de modo que un secreto que aparezca en el objeto de origen
 * (por ejemplo la contraseña que imprime `bridge info`) no llegue nunca a
 * `structuredContent` ni al texto JSON (hallazgo F04).
 */
function publicFields(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) {
      out[key] = source[key]
    }
  }
  return out
}

const HEALTH_FIELDS = [
  'ok',
  'processRunning',
  'imapListening',
  'smtpListening',
  'authOk',
  'error',
] as const

const STATUS_FIELDS = [...HEALTH_FIELDS, 'user', 'version', 'imapPort', 'smtpPort'] as const

const INFO_FIELDS = ['user', 'version', 'imapPort', 'smtpPort'] as const

export interface BridgeToolDeps {
  /**
   * `true` permite que el modelo transporte la contraseña y el TOTP.
   * `false` (por defecto) los lee de su origen configurado y solo devuelve
   * metadatos: el secreto principal no debe pasar por el cliente, el transporte
   * ni los logs del modelo (hallazgo F06).
   */
  readonly secretsFromModel: boolean;
  /** Credenciales configuradas, para el modo sin secretos en el modelo. */
  readonly bridgeUser: string;
  readonly resolvePassword: () => Promise<string>;
  readonly resolveTotp?: () => Promise<string | undefined>;
}

export function registerBridgeTools(
  register: RegisterFn,
  bridge: BridgeClient,
  _log: Logger,
  deps?: BridgeToolDeps,
) {
  const secretsFromModel = deps?.secretsFromModel ?? false;
  register(
    'proton_bridge_health',
    {
      title: 'Bridge health check',
      description: 'Checks if Proton Mail Bridge is running, ports are listening, and IMAP auth works.',
      inputSchema: {
        response_format: z.enum(['markdown', 'json']).default('markdown'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      const health = await bridge.health()
      const pub = publicFields(health, HEALTH_FIELDS)
      if (response_format === 'json') {
        return {
          content: [{ type: 'text', text: JSON.stringify(pub, null, 2) }],
          structuredContent: pub,
        }
      }
      const lines = [
        '# Proton Bridge Health',
        '',
        `- OK: ${health.ok}`,
        `- Process running: ${health.processRunning}`,
        `- IMAP listening: ${health.imapListening}`,
        `- SMTP listening: ${health.smtpListening}`,
        `- Auth OK: ${health.authOk}`,
      ]
      if (health.error) lines.push(`- Error: ${health.error}`)
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  register(
    'proton_bridge_status',
    {
      title: 'Bridge full status',
      description: 'Returns combined info + health of the Bridge process in a single call.',
      inputSchema: {
        response_format: z.enum(['markdown', 'json']).default('markdown'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      const st = await bridge.status()
      const pub = publicFields(st, STATUS_FIELDS)
      if (response_format === 'json') {
        return {
          content: [{ type: 'text', text: JSON.stringify(pub, null, 2) }],
          structuredContent: pub,
        }
      }
      const lines = [
        '# Proton Bridge Status',
        '',
        `- User: ${st.user ?? '(none)'}`,
        `- Version: ${st.version ?? 'unknown'}`,
        `- Process running: ${st.processRunning}`,
        `- IMAP listening: ${st.imapListening}`,
        `- SMTP listening: ${st.smtpListening}`,
        `- Auth OK: ${st.authOk}`,
      ]
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  register(
    'proton_bridge_info',
    {
      title: 'Bridge info',
      description: 'Returns Bridge version, user, and connection ports from the CLI.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const info = await bridge.info()
      const pub = publicFields(info, INFO_FIELDS)
      return {
        content: [
          {
            type: 'text',
            text: [
              '# Proton Bridge Info',
              '',
              `- User: ${info.user ?? '(none)'}`,
              `- Version: ${info.version ?? 'unknown'}`,
              `- IMAP port: ${info.imapPort ?? 'N/A'}`,
              `- SMTP port: ${info.smtpPort ?? 'N/A'}`,
            ].join('\n'),
          },
        ],
        structuredContent: pub,
      }
    },
  )

  register(
    'proton_bridge_login',
    {
      title: 'Login to Bridge',
      description: secretsFromModel
        ? 'Performs interactive login against Proton Mail Bridge. Provide user and password; include TOTP if 2FA is required. NOT SECURE: the password travels through you.'
        : 'Logs in to Proton Mail Bridge using the credentials configured on this machine (PROTON_BRIDGE_PASS or a password-store reference). Takes no arguments: the password never travels through you, and the result contains metadata only.',
      inputSchema: secretsFromModel
        ? {
            user: z.email(),
            password: z.string(),
            totp: z.string().optional(),
          }
        : {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    // El handler recibe los argumentos ya validados; en modo seguro el esquema
    // está vacío, así que se leen del origen configurado.
    (async (args: Record<string, unknown>) => {
      const secrets = await resolveLoginSecrets(args, deps)
      if (!secrets.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: secrets.reason }],
        }
      }
      const result = await bridge.login(secrets.user, secrets.password, secrets.totp)
      return {
        content: [
          {
            type: 'text',
            text: result.ok
              ? `Login successful: ${result.message}`
              : `Login failed: ${result.message}${result.needs2FA ? ' (2FA required)' : ''}`,
          },
        ],
        // Solo metadatos: nunca la contraseña ni el TOTP.
        structuredContent: asStructured({
          ok: result.ok,
          message: result.message,
          needs2FA: result.needs2FA === true,
        }),
      }
    }) as never,
  )

  register(
    'proton_bridge_logout',
    {
      title: 'Logout from Bridge',
      description: 'Logs out the current session from Proton Mail Bridge.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const result = await bridge.logout()
      return {
        content: [{ type: 'text', text: result.ok ? 'Logged out' : 'Logout failed' }],
        structuredContent: asStructured(result),
      }
    },
  )

  register(
    'proton_bridge_accounts',
    {
      title: 'List Bridge accounts',
      description: 'Lists all Proton accounts currently configured in Bridge with their connection state.',
      inputSchema: {
        response_format: z.enum(['markdown', 'json']).default('markdown'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      const accounts = await bridge.listAccounts()
      if (response_format === 'json') {
        return {
          content: [{ type: 'text', text: JSON.stringify(accounts, null, 2) }],
          structuredContent: { accounts },
        }
      }
      const lines = ['# Proton Bridge Accounts', '']
      if (accounts.length === 0) {
        lines.push('No accounts configured.')
      } else {
        for (const a of accounts) {
          lines.push(`- ${a.user}: ${a.state}`)
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )
}

/** Resultado de resolver las credenciales de login. */
type LoginSecrets =
  | { ok: true; user: string; password: string; totp: string | undefined }
  | { ok: false; reason: string }

/**
 * Resuelve las credenciales de login.
 *
 * En modo seguro NO se aceptan argumentos: se leen del origen configurado, así
 * que la contraseña nunca pasa por el cliente ni por el modelo (hallazgo F06).
 */
async function resolveLoginSecrets(
  args: Record<string, unknown>,
  deps?: BridgeToolDeps,
): Promise<LoginSecrets> {
  if (deps?.secretsFromModel === true) {
    const user = args['user']
    const password = args['password']
    if (typeof user !== 'string' || typeof password !== 'string') {
      return { ok: false, reason: 'Faltan user o password.' }
    }
    return {
      ok: true,
      user,
      password,
      totp: typeof args['totp'] === 'string' ? args['totp'] : undefined,
    }
  }

  if (!deps) {
    return { ok: false, reason: 'Falta la configuración del Bridge en el servidor.' }
  }
  if (deps.bridgeUser.length === 0) {
    return {
      ok: false,
      reason:
        'No hay usuario de Bridge configurado. Define PROTON_BRIDGE_USER en el entorno del servidor.',
    }
  }

  let password: string
  try {
    password = await deps.resolvePassword()
  } catch (err) {
    return {
      ok: false,
      reason: `No se pudo obtener la contraseña del Bridge desde su origen configurado: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }
  if (password.length === 0) {
    return {
      ok: false,
      reason:
        'La contraseña del Bridge está vacía. Define PROTON_BRIDGE_PASS o PROTON_BRIDGE_PASS_PATH.',
    }
  }

  let totp: string | undefined
  if (deps.resolveTotp) {
    try {
      totp = await deps.resolveTotp()
    } catch {
      // Sin TOTP se intenta igualmente; el CLI dirá si hacía falta.
      totp = undefined
    }
  }
  return { ok: true, user: deps.bridgeUser, password, totp }
}
