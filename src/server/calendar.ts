/**
 * Calendar tools — STUB. Proton Calendar uses E2E-encrypted sync;
 * no third-party CalDAV access is possible.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { effectOf, hintsFor } from '../authz/index.js'
import type { createLogger } from '../config.js'

type Logger = ReturnType<typeof createLogger>

export function registerCalendarTools(
  server: McpServer,
  deps: { log: Logger; enabled: boolean; experimental: boolean },
) {
  if (!deps.enabled) return

  if (!deps.experimental) {
    deps.log.warn('Calendar tools are experimental — set PROTON_CALENDAR_EXPERIMENTAL=1 to enable.')
    return
  }

  deps.log.warn('Calendar tools are stubs — Proton Calendar uses E2E-encrypted sync, not CalDAV.')

  const unavailable = JSON.stringify({
    available: false,
    reason: 'Proton Calendar uses E2E-encrypted sync; no third-party CalDAV access.',
  })

  for (const t of [
    'proton_calendar_list_events',
    'proton_calendar_create_event',
    'proton_calendar_list_calendars',
  ]) {
    server.registerTool(
      t,
      {
        title: t,
        description: `[STUB] ${t} — E2E-encrypted sync, no CalDAV.`,
        inputSchema: {},
        annotations: { ...hintsFor(effectOf(t)?.effectClass ?? 'admin'), openWorldHint: true },
      },
      () => ({ content: [{ type: 'text', text: unavailable }] }),
    )
  }
}
