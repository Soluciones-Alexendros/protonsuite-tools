import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { IDriveClient, IImapClient, IPassClient } from '../clients/interfaces.js'
import type { createLogger, Config } from '../config.js'

type Logger = ReturnType<typeof createLogger>

// ---------------------------------------------------------------------------
// Suite status with diagnostics
// ---------------------------------------------------------------------------
export function registerSuiteTool(
  server: McpServer,
  deps: {
    cfg: Config
    log: Logger
    imap: IImapClient
    driveClient: IDriveClient | undefined
    passwordResolver: () => Promise<string>
    bridgeCfg: Config['products']['mail']['bridge']
    passClient: IPassClient | undefined
  },
) {
  const { cfg, imap, driveClient, passwordResolver, bridgeCfg, passClient } = deps
  server.registerTool(
    'proton_suite_status',
    {
      title: 'Get Proton Suite unified status',
      description:
        'Reports the connection status, diagnostics, and metrics of all configured Proton Suite products.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      let mailStatus: Record<string, unknown> = {
        available: false,
        error: 'not_configured',
      }
      let passStatus: Record<string, unknown> = {
        available: false,
        error: 'not_configured',
      }

      if (cfg.products.mail.enabled) {
        try {            const { diagnoseMail } = await import('../diagnostics.js')
          const diag = await diagnoseMail(bridgeCfg, passwordResolver)
          let connected = false
          let mailboxes: number | undefined
          let unread: number | undefined
          if (diag.auth?.ok && diag.folders?.accessible) {
            connected = true
            mailboxes = diag.folders.count
            try {
              const folders = await imap.listMailboxes()
              const status = await imap.mailboxStatus('INBOX')
              mailboxes = folders.length
              unread = status.unseen
            } catch {
              /* fallback to diagnostics count */
            }
          }
          mailStatus = {
            available: true,
            connected,
            mailboxes,
            unread,
            error: connected
              ? undefined
              : (diag.auth?.error ??
                diag.imapHandshake?.error ??
                diag.tcp.error),
            diagnostics: diag,
          }
        } catch (err) {
          mailStatus = {
            available: false,
            connected: false,
            error: String(err),
          }
        }
      }

      if (cfg.products.pass.enabled && passClient) {
        try {
          const h = await passClient.health()
          passStatus = {
            available: true,
            connected: h.ok,
            entries: h.entries,
            error: h.error,
          }
        } catch (err) {
          passStatus = {
            available: false,
            connected: false,
            error: String(err),
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                mail: mailStatus,
                pass: passStatus,
                calendar: cfg.products.calendar.enabled
                  ? {
                      available: false,
                      reason: 'Proton Calendar uses E2E-encrypted sync; no third-party CalDAV access.',
                    }
                  : { available: false },
                drive: cfg.products.drive.enabled && driveClient
                  ? (() => {
                      try {
                        const deps = driveClient.checkDeps()
                        return {
                          available: deps.ok,
                          cliPath: cfg.products.drive.cliBin,
                          stagingDir: cfg.products.drive.stagingDir,
                          ...(deps.error ? { error: deps.error } : {}),
                        }
                      } catch (err) {
                        return { available: false, error: String(err) }
                      }
                    })()
                  : { available: false, reason: 'DRIVE_ENABLED=false' },
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}