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

export function registerBridgeTools(
  register: RegisterFn,
  bridge: BridgeClient,
  _log: Logger,
) {
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
      description: 'Performs interactive login against Proton Mail Bridge. Provide user and password; include TOTP if 2FA is required.',
      inputSchema: {
        user: z.email(),
        password: z.string(),
        totp: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ user, password, totp }) => {
      const result = await bridge.login(user, password, totp)
      return {
        content: [
          {
            type: 'text',
            text: result.ok
              ? `Login successful: ${result.message}`
              : `Login failed: ${result.message}${result.needs2FA ? ' (2FA required)' : ''}`,
          },
        ],
        structuredContent: asStructured(result),
      }
    },
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
