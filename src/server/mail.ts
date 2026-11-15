import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { IImapClient } from '../clients/interfaces.js'
import type { ISmtpClient } from '../clients/interfaces.js'
import type { createLogger, Config } from '../config.js'
import { ATTACH_INLINE_THRESHOLD, ATTACH_MAX_SIZE } from '../constants.js'
import { buildForwardOptions, buildReplyOptions } from '../smtp.js'
import {
  attachmentSchema,
  emailFullSchema,
  emailListSchema,
  emailSearchSchema,
  folderListSchema,
  mailboxStatusSchema,
} from './types.js'
import {
  buildSearchCriteria,
  renderEmailList,
  renderFullEmail,
  resolveTrashPath,
} from './utils.js'

type Logger = ReturnType<typeof createLogger>

interface MailDeps {
  cfg: Config
  log: Logger
  imap: IImapClient
  smtp: ISmtpClient
}

export function registerMailTools(server: McpServer, deps: MailDeps) {
  registerFolderTools(server, deps)
  registerListSearchTools(server, deps)
  registerReadTools(server, deps)
  registerSendTools(server, deps)
  registerModifyTools(server, deps)
}

function registerFolderTools(server: McpServer, deps: MailDeps) {
  const { imap } = deps
  server.registerTool(
    'proton_list_folders',
    {
      title: 'List mailboxes (folders/labels)',
      description:
        "Lists every IMAP mailbox exposed by Proton Bridge (system folders like INBOX/Sent/Trash and user labels/folders). Use the returned 'path' values as the mailbox argument in other tools. Call this first when the agent doesn't know the mailbox layout.",
      inputSchema: {
        response_format: z
          .enum(['markdown', 'json'])
          .default('markdown')
          .describe('Output format'),
      },
      outputSchema: folderListSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ response_format }) => {
      const mbs = await imap.listMailboxes()
      const structured = { folders: mbs }
      if (response_format === 'json') {
        return {
          content: [{ type: 'text', text: JSON.stringify(mbs, null, 2) }],
          structuredContent: structured,
        }
      }
      const lines = [
        '| Path | Name | Special-use | Flags |',
        '|---|---|---|---|',
        ...mbs.map(
          (m) =>
            `| \`${m.path}\` | ${m.name} | ${m.specialUse ?? '—'} | ${m.flags.join(', ') || '—'} |`,
        ),
      ]
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: structured,
      }
    },
  )

  server.registerTool(
    'proton_create_folder',
    {
      title: 'Create a mailbox (folder)',
      description:
        "Creates a new IMAP mailbox under the given path (e.g. 'Projects/Afiladocs').",
      inputSchema: {
        path: z.string().min(1).describe('Mailbox path to create'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ path }) => {
      const res = await imap.createMailbox(path)
      return {
        content: [
          { type: 'text', text: `Created ${res.path} (new=${res.created}).` },
        ],
      }
    },
  )

  server.registerTool(
    'proton_mailbox_status',
    {
      title: 'Get mailbox counts',
      description:
        "Returns total messages, unseen/unread count and recent count for a mailbox. Fast — useful for Routines to check 'do I have unread mail?'.",
      inputSchema: {
        mailbox: z
          .string()
          .default('INBOX')
          .describe('Mailbox path, e.g. INBOX'),
      },
      outputSchema: mailboxStatusSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ mailbox }) => {
      const s = await imap.mailboxStatus(mailbox)
      return {
        content: [
          {
            type: 'text',
            text: `**${mailbox}** — total: ${s.messages}, unseen: ${s.unseen}, recent: ${s.recent}${s.uidNext ? `, uidNext: ${s.uidNext}` : ''}`,
          },
        ],
        structuredContent: {
          mailbox,
          messages: s.messages,
          unseen: s.unseen,
          recent: s.recent,
          ...(s.uidNext ? { uidNext: s.uidNext } : {}),
        },
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Listing and search
// ---------------------------------------------------------------------------
function registerListSearchTools(server: McpServer, deps: MailDeps) {
  server.registerTool(
    'proton_list_emails',
    {
      title: 'List emails in a mailbox',
      description:
        'Lists recent emails in a mailbox, newest first. Use pagination with offset+limit. Returns UID, from, to, subject, date, flags, size. Does NOT return the body — use proton_get_email for that.',
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
        response_format: z
          .enum(['markdown', 'json', 'concise'])
          .default('markdown')
          .describe('markdown table, json, or concise bullet list (fewer tokens)'),
      },
      outputSchema: emailListSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true,
      },
    },      (args) => handleListEmails(deps, args),
  )

  server.registerTool(
    'proton_search_emails',
    {
      title: 'Search emails',
      description:
        "Keyword-search emails in a mailbox. Filter by text in any field, or restrict to subject/from/to/body. Combine with date range and unseen flag. Returns newest matches first, up to 'limit'. Use 'text' for a broad 'anywhere' match.",
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        query: z.string().optional().describe('Keyword to search for'),
        fields: z
          .array(z.enum(['text', 'subject', 'from', 'to', 'body']))
          .default(['text'])
          .describe("Which fields to search. 'text' = anywhere."),
        since: z
          .string()
          .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid ISO date')
          .optional()
          .describe('ISO date — only messages on/after this date'),
        before: z
          .string()
          .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid ISO date')
          .optional()
          .describe('ISO date — only messages before this date'),
        unseen_only: z
          .boolean()
          .default(false)
          .describe('Only return unread messages'),
        from_address: z
          .string()
          .optional()
          .describe('Restrict to messages from this address'),
        to_address: z
          .string()
          .optional()
          .describe('Restrict to messages to this address'),
        limit: z.number().int().min(1).max(100).default(25),
        response_format: z
          .enum(['markdown', 'json', 'concise'])
          .default('markdown')
          .describe('markdown table, json, or concise bullet list (fewer tokens)'),
      },
      outputSchema: emailSearchSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true,
      },
    },      (args) => handleSearchEmails(deps, args),
  )
}

async function handleListEmails(
  deps: MailDeps,
  {
    mailbox,
    limit,
    offset,
    response_format,
  }: {
    mailbox: string
    limit: number
    offset: number
    response_format: 'markdown' | 'json' | 'concise'
  },
) {
  const { imap } = deps
  const { items, total } = await imap.listEmails(mailbox, limit, offset)
  const structured = {
    mailbox,
    total,
    count: items.length,
    offset,
    has_more: offset + items.length < total,
    next_offset: offset + items.length,
    items,
  }
  if (response_format === 'json') {
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(structured, null, 2) },
      ],
      structuredContent: structured,
    }
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: renderEmailList(
          items,
          mailbox,
          total,
          offset,
          response_format === 'concise',
        ),
      },
    ],
    structuredContent: structured,
  }
}

async function handleSearchEmails(
  deps: MailDeps,
  args: {
    mailbox: string
    query: string | undefined
    fields: ('text' | 'subject' | 'from' | 'to' | 'body')[]
    since: string | undefined
    before: string | undefined
    unseen_only: boolean
    from_address: string | undefined
    to_address: string | undefined
    limit: number
    response_format: 'markdown' | 'json' | 'concise'
  },
) {
  const { imap } = deps
  const criteria = buildSearchCriteria(args)
  const { items, matched } = await imap.searchEmails(
    args.mailbox,
    criteria as Record<string, unknown>,
    args.limit,
  )
  const structured = {
    mailbox: args.mailbox,
    matched,
    count: items.length,
    has_more: matched > items.length,
    items,
  }
  if (args.response_format === 'json') {
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(structured, null, 2) },
      ],
      structuredContent: structured,
    }
  }
  const list = renderEmailList(
    items,
    args.mailbox,
    matched,
    0,
    args.response_format === 'concise',
  )
  return {
    content: [
      {
        type: 'text' as const,
        text:
          args.response_format === 'concise'
            ? list
            : `Matched ${matched} message(s), showing ${items.length}.\n\n${list}`,
      },
    ],
    structuredContent: structured,
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
function registerReadTools(server: McpServer, deps: MailDeps) {
  const { imap } = deps
  server.registerTool(
    'proton_get_email',
    {
      title: 'Read one email (full body)',
      description:
        'Fetches one email by UID, with headers, text/html body and attachment metadata. Use proton_get_attachment to download attachment bytes. Large HTML bodies are returned as-is — truncate client-side if needed. To mark as read, call proton_flag_email separately (keeps this tool purely read-only).',
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        uid: z
          .number()
          .int()
          .positive()
          .describe('Message UID (from list/search)'),
        include_html: z
          .boolean()
          .default(false)
          .describe('Include HTML body in addition to text'),
        response_format: z.enum(['markdown', 'json']).default('markdown'),
      },
      outputSchema: emailFullSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ mailbox, uid, include_html, response_format }) => {
      const msg = await imap.getEmail(mailbox, uid)
      if (!msg) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `No message with UID ${uid} in ${mailbox}.`,
            },
          ],
        }
      }
      const out = include_html ? msg : { ...msg, htmlBody: undefined }
      const text =
        response_format === 'json'
          ? JSON.stringify(out, null, 2)
          : renderFullEmail(out)
      return {
        content: [{ type: 'text', text }],
        structuredContent: out as unknown as Record<string, unknown>,
      }
    },
  )

  server.registerTool(
    'proton_get_attachment',
    {
      title: 'Download an attachment',
      description:
        'Returns the bytes of a specific attachment encoded as base64. Use the attachment index from proton_get_email. Large attachments are truncated to max_bytes (default 10 MB) with a truncated=true flag in the response.',
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        uid: z.number().int().positive(),
        index: z
          .number()
          .int()
          .min(0)
          .describe('Zero-based index in the attachments array'),
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(ATTACH_MAX_SIZE)
          .default(ATTACH_INLINE_THRESHOLD)
          .describe(
            'Maximum attachment size in bytes (default 10 MB, hard cap 50 MB)',
          ),
      },
      outputSchema: attachmentSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ mailbox, uid, index, max_bytes }) => {
      const att = await imap.getAttachment(mailbox, uid, index)
      if (!att) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Attachment #${index} not found for UID ${uid}.`,
            },
          ],
        }
      }
      // Defensa contra "adjunto gigante satura el contexto del LLM".
      // Devolvemos siempre `size_bytes` (original) y `returned_bytes` (real
      // servido) para que el consumidor pueda decidir si reintentar con
      // max_bytes más alto o solicitar por otra vía.
      const bytes = Buffer.from(att.base64, 'base64')
      const truncated = bytes.byteLength > max_bytes
      const payload = truncated ? bytes.subarray(0, max_bytes) : bytes
      const structured = {
        filename: att.filename,
        contentType: att.contentType,
        size_bytes: bytes.byteLength,
        returned_bytes: payload.byteLength,
        truncated,
        base64: payload.toString('base64'),
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(structured) }],
        structuredContent: structured,
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Send / reply / forward
// ---------------------------------------------------------------------------
function registerSendTools(server: McpServer, deps: MailDeps) {
  const { cfg, imap, smtp } = deps
  server.registerTool(
    'proton_send_email',
    {
      title: 'Send an email',
      description:
        "Sends an email via Proton Bridge SMTP. 'from' is fixed to the configured address. Provide either text, html, or both. Attachments are base64-encoded bytes.",
      inputSchema: {
        to: z.array(z.email()).min(1).describe('Recipient addresses'),
        subject: z.string().min(1),
        text: z.string().optional(),
        html: z.string().optional(),
        cc: z.array(z.email()).optional(),
        bcc: z.array(z.email()).optional(),
        reply_to: z.email().optional(),
        attachments: z
          .array(
            z.object({
              filename: z.string(),
              content_base64: z.string(),
              content_type: z.string().optional(),
            }),
          )
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      if (!args.text && !args.html) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: "Provide at least one of 'text' or 'html'.",
            },
          ],
        }
      }
      const res = await smtp.send({
        to: args.to,
        ...(args.cc !== undefined ? { cc: args.cc } : {}),
        ...(args.bcc !== undefined ? { bcc: args.bcc } : {}),
        subject: args.subject,
        ...(args.text !== undefined ? { text: args.text } : {}),
        ...(args.html !== undefined ? { html: args.html } : {}),
        ...(args.reply_to !== undefined ? { replyTo: args.reply_to } : {}),
        ...(args.attachments !== undefined
          ? {
              attachments: args.attachments.map((a) => ({
                filename: a.filename,
                contentBase64: a.content_base64,
                ...(a.content_type !== undefined ? { contentType: a.content_type } : {}),
              })),
            }
          : {}),
      })
      return {
        content: [
          {
            type: 'text',
            text: `Sent. messageId=${res.messageId} accepted=${res.accepted.length} rejected=${res.rejected.length}`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'proton_reply_email',
    {
      title: 'Reply to an email',
      description:
        'Replies to an existing message preserving threading (In-Reply-To, References). Set reply_all=true to include CC recipients. Set include_quote=true to quote the original.',
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        uid: z.number().int().positive(),
        text: z.string().optional(),
        html: z.string().optional(),
        reply_all: z.boolean().default(false),
        include_quote: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      if (!args.text && !args.html) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: "Provide at least one of 'text' or 'html'.",
            },
          ],
        }
      }
      const opts = await buildReplyOptions({
        imap,
        mailbox: args.mailbox,
        uid: args.uid,
        body: {
          ...(args.text !== undefined ? { text: args.text } : {}),
          ...(args.html !== undefined ? { html: args.html } : {}),
        },
        includeQuote: args.include_quote,
        replyAll: args.reply_all,
        ownAddress: cfg.products.mail.bridge.from,
      })
      if (!opts)
        return {
          isError: true,
          content: [
            { type: 'text', text: `Original UID ${args.uid} not found.` },
          ],
        }
      if (opts.to.length === 0)
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Original has no reply-to address.' },
          ],
        }
      const res = await smtp.send(opts)
      return {
        content: [
          {
            type: 'text',
            text: `Reply sent to ${opts.to.join(', ')}. messageId=${res.messageId} accepted=${res.accepted.length}`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'proton_forward_email',
    {
      title: 'Forward an email',
      description:
        'Forwards an existing message to new recipients. Optionally includes original attachments.',
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        uid: z.number().int().positive(),
        to: z.array(z.email()).min(1),
        text: z.string().optional(),
        html: z.string().optional(),
        include_attachments: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const opts = await buildForwardOptions(
        imap,
        args.mailbox,
        args.uid,
        args.to,
        {
          ...(args.text !== undefined ? { text: args.text } : {}),
          ...(args.html !== undefined ? { html: args.html } : {}),
        },
        args.include_attachments,
      )
      if (!opts)
        return {
          isError: true,
          content: [
            { type: 'text', text: `Original UID ${args.uid} not found.` },
          ],
        }
      const res = await smtp.send(opts)
      return {
        content: [
          {
            type: 'text',
            text: `Forwarded to ${args.to.join(', ')}. messageId=${res.messageId}`,
          },
        ],
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Modify
// ---------------------------------------------------------------------------
function registerModifyTools(server: McpServer, deps: MailDeps) {
  const { imap } = deps
  server.registerTool(
    'proton_flag_email',
    {
      title: 'Flag / unflag emails',
      description:
        "Toggles per-message flags. Supported: 'read', 'unread', 'starred', 'unstarred'. For custom flags, pass add_flags/remove_flags directly.",
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        uid: z.number().int().positive(),
        action: z
          .enum(['read', 'unread', 'starred', 'unstarred', 'custom'])
          .describe('Shorthand action'),
        add_flags: z
          .array(z.string())
          .optional()
          .describe('Custom flags to add (action=custom only)'),
        remove_flags: z
          .array(z.string())
          .optional()
          .describe('Custom flags to remove (action=custom only)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ mailbox, uid, action, add_flags, remove_flags }) => {
      let add: string[] = []
      let remove: string[] = []
      switch (action) {
        case 'read':
          add = ['\\Seen']
          break
        case 'unread':
          remove = ['\\Seen']
          break
        case 'starred':
          add = ['\\Flagged']
          break
        case 'unstarred':
          remove = ['\\Flagged']
          break
        case 'custom':
          add = add_flags ?? []
          remove = remove_flags ?? []
          break
      }
      const ok = await imap.setFlags(mailbox, uid, add, remove)
      return {
        content: [
          {
            type: 'text',
            text: ok
              ? `Flags updated on UID ${uid}.`
              : `Failed to update flags on UID ${uid}.`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'proton_move_email',
    {
      title: 'Move an email to another mailbox',
      description:
        'Moves a message by UID from one mailbox to another. Use proton_list_folders to see valid targets.',
      inputSchema: {
        from_mailbox: z.string(),
        uid: z.number().int().positive(),
        to_mailbox: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ from_mailbox, uid, to_mailbox }) => {
      const ok = await imap.moveEmail(from_mailbox, uid, to_mailbox)
      return {
        content: [
          {
            type: 'text',
            text: ok ? `Moved UID ${uid} → ${to_mailbox}` : `Move failed.`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'proton_delete_email',
    {
      title: 'Delete an email',
      description:
        "Deletes a message. Default mode='trash' moves it to Trash (reversible). mode='permanent' expunges immediately — cannot be undone.",
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        uid: z.number().int().positive(),
        mode: z.enum(['trash', 'permanent']).default('trash'),
        trash_path: z
          .string()
          .optional()
          .describe(
            'Override for the Trash mailbox path. If omitted, the \\Trash special-use mailbox is auto-detected (works with Papelera/Corbeille/etc.).',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ mailbox, uid, mode, trash_path }) => {
      if (mode === 'trash') {
        const target = await resolveTrashPath(imap, trash_path)
        const ok = await imap.moveEmail(mailbox, uid, target)
        return {
          content: [
            {
              type: 'text',
              text: ok
                ? `Moved UID ${uid} to ${target}.`
                : 'Delete-to-trash failed.',
            },
          ],
        }
      }
      const ok = await imap.deleteEmail(mailbox, uid)
      return {
        content: [
          {
            type: 'text',
            text: ok ? `Permanently deleted UID ${uid}.` : 'Delete failed.',
          },
        ],
      }
    },
  )
}

