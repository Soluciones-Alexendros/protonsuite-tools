import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { secretsFromModel, type createLogger, type Config } from '../config.js'
import { PassClient } from '../pass.js'

type Logger = ReturnType<typeof createLogger>

export function registerPassTools(
  server: McpServer,
  deps: { cfg: Config; log: Logger },
) {
  const { cfg, log } = deps
  if (!cfg.products.pass.enabled) return
  const passClient = new PassClient(
    {
      storeDir: cfg.products.pass.storeDir,
      backend: cfg.products.pass.backend ?? 'pass',
    },
    log,
  )

  server.registerTool(
    'proton_pass_list',
    {
      title: 'List Proton Pass entries',
      description:
        'Lists entries in the Proton Pass password store. Returns entry names/paths only — NEVER secret values.',
      inputSchema: {
        filter: z.string().optional(),
        response_format: z.enum(['markdown', 'json']).default('json'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ filter, response_format }) => {
      try {
        const entries = await passClient.list(filter)
        if (response_format === 'json') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ entries, count: entries.length }),
              },
            ],
          }
        }
        return {
          content: [
            {
              type: 'text',
              text:
                entries.length === 0
                  ? 'No entries found.'
                  : `**${entries.length} entries:**\n${entries.map((e) => `- ${e}`).join('\n')}`,
            },
          ],
        }
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: String(err) }],
        }
      }
    },
  )

  server.registerTool(
    'proton_pass_get',
    {
      title: 'Resolve a secret from Proton Pass',
      description:
        'Resolves a secret from Proton Pass. Returns {found:true} without the secret value.',
      inputSchema: {
        path: z.string().describe('Entry path in the password store'),
      },
      annotations: { openWorldHint: true },
    },
    async ({ path }) => {
      try {
        await passClient.get(path)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ found: true, path, injected: true }),
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                found: false,
                path,
                error: String(err),
              }),
            },
          ],
        }
      }
    },
  )

  server.registerTool(
    'proton_pass_generate',
    {
      title: 'Generate a secure password',
      description:
        'Generates a strong random password and saves it to the Proton Pass store. Refuses to overwrite an existing entry unless overwrite=true is set explicitly.',
      inputSchema: {
        path: z.string(),
        length: z.number().int().min(12).max(128).default(24),
        overwrite: z
          .boolean()
          .default(false)
          .describe(
            'Explicitly replace an existing entry. Leaves a backup copy of the previous ciphertext. Default: false (no-clobber).',
          ),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ path, length, overwrite }) => {
      try {
        const result = await passClient.generate(
          path,
          length,
          overwrite ? { overwrite: true } : {},
        )
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ generated: true, ...result }),
            },
          ],
        }
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: String(err) }],
        }
      }
    },
  )

  server.registerTool(
    'proton_pass_health',
    {
      title: 'Check Proton Pass store health',
      description: 'Verifies the Proton Pass password store is accessible.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const r = await passClient.health()
      return { content: [{ type: 'text', text: JSON.stringify(r) }] }
    },
  )

  server.registerTool(
    'proton_pass_insert',
    {
      title: 'Insert a secret into Proton Pass store',
      // En el perfil seguro la herramienta NO acepta el valor: guardar un
      // secreto exige escribirlo en un sitio por el que pasa el modelo. Se
      // registra igualmente para poder explicar cómo hacerlo bien, en lugar de
      // desaparecer sin más (hallazgo F06).
      description: secretsFromModel(cfg)
        ? 'Stores a new entry. Refuses to overwrite an existing entry unless overwrite=true is set explicitly. Never logs nor returns the secret value. NOT SECURE: the secret travels through you.'
        : 'Not available in this profile: storing a secret would make it travel through the model. Run `pass insert <path>` on the machine instead.',
      inputSchema: secretsFromModel(cfg)
        ? {
            path: z.string().describe('Entry path, e.g. proton/bridge/api-key'),
            secret: z.string().describe('The secret value to store.'),
            overwrite: z
              .boolean()
              .default(false)
              .describe(
                'Explicitly replace an existing entry. Leaves a backup copy of the previous ciphertext. Default: false (no-clobber).',
              ),
          }
        : {
            path: z.string().describe('Entry path, e.g. proton/bridge/api-key'),
          },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: { path: string }) => {
      if (!secretsFromModel(cfg)) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: [
                'No se ha guardado nada: en este perfil el secreto no viaja por el modelo.',
                '',
                'Guárdalo tú desde tu terminal:',
                `  pass insert ${args.path}`,
                '',
                'Si necesitas que el agente transporte el secreto, pon SECRETS_FROM_MODEL=true.',
                'No es lo recomendado: el valor queda en el cliente, en el transporte y en los logs del modelo.',
              ].join('\n'),
            },
          ],
          structuredContent: { status: 'refused', reason: 'secrets-from-model-disabled' },
        }
      }
      return insertWithSecret(args)
    },
  )

  async function insertWithSecret(args: {
    path: string
    secret?: string
    overwrite?: boolean
  }) {
    try {
      const result = await passClient.insert(
        args.path,
        args.secret ?? '',
        args.overwrite === true ? { overwrite: true } : {},
      )
      const suffix = result.backupPath ? ` (backup: ${result.backupPath})` : ''
      return {
        content: [{ type: 'text' as const, text: `Inserted entry: ${args.path}${suffix}` }],
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: String(err) }],
      }
    }
  }


  server.registerTool(
    'proton_pass_remove',
    {
      title: 'Remove a secret from Proton Pass store',
      description: 'Permanently removes an entry from the local pass-store.',
      inputSchema: { path: z.string().describe('Entry path to remove') },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path }) => {
      await passClient.remove(path)
      return { content: [{ type: 'text', text: `Removed entry: ${path}` }] }
    },
  )

  server.registerTool(
    'proton_pass_move',
    {
      title: 'Move/rename a secret in Proton Pass store',
      description: 'Moves or renames an entry in the local pass-store.',
      inputSchema: {
        from: z.string().describe('Current entry path'),
        to: z.string().describe('New entry path'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ from, to }) => {
      await passClient.move(from, to)
      return {
        content: [{ type: 'text', text: `Moved ${from} \u2192 ${to}` }],
      }
    },
  )

  server.registerTool(
    'proton_pass_copy',
    {
      title: 'Copy a secret in Proton Pass store',
      description: 'Copies an entry in the local pass-store.',
      inputSchema: {
        src: z.string().describe('Source entry path'),
        dst: z.string().describe('Destination entry path'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ src, dst }) => {
      await passClient.copy(src, dst)
      return {
        content: [{ type: 'text', text: `Copied ${src} \u2192 ${dst}` }],
      }
    },
  )
}