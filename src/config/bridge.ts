/**
 * Schema de configuración del Bridge IMAP/SMTP de Proton Mail.
 *
 * Extraído de src/config.ts para reducir el tamaño de la fachada principal.
 * Sin dependencias circulares — solo importa zod.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Mail Bridge schema — compartido entre ConfigSchema y el runtime para
// extenderlo con el passwordResolver (inyectado por buildServer, no por env).
// ---------------------------------------------------------------------------
export const MailBridgeSchema = z
  .object({
    user: z
      .string()
      .min(1, 'PROTON_BRIDGE_USER is required when mail is enabled'),
    pass: z.string().default(''),
    // Path en el password store de Pass desde el que resolver la contraseña
    // JIT. Si se define y PROTON_PASS_ENABLED=true, `pass` puede estar vacío.
    passPath: z.string().optional(),
    // Ruta en el password store desde la que resolver el TOTP JIT. Existe para
    // que el segundo factor NO tenga que pasar por el modelo (hallazgo F06).
    totpPath: z.string().optional(),
    host: z.string().default('127.0.0.1'),
    imapPort: z.number().int().positive().default(1143),
    smtpPort: z.number().int().positive().default(1025),
    from: z.email('PROTON_MAIL_FROM must be a valid email'),
    /**
     * Si es `true`, NO se valida el certificado del servidor. Viene a `true`
     * por comodidad con el certificado autofirmado de Bridge en local, y por eso
     * el servidor avisa en voz alta al arrancar (hallazgo F34).
     */
    tlsInsecure: z.boolean().default(true),
    /** Ruta absoluta al PEM con la CA de Bridge. Con esto se puede validar. */
    caPath: z.string().optional(),
    smtpSecurity: z.enum(['starttls', 'implicit', 'plain']).default('starttls'),
  })
  .refine((data) => data.pass.length > 0 || !!data.passPath, {
    message:
      'PROTON_BRIDGE_PASS or PROTON_BRIDGE_PASS_PATH is required when mail is enabled',
  })

export type BridgeConfig = z.infer<typeof MailBridgeSchema>

export type ResolvedBridgeConfig = BridgeConfig & {
  passwordResolver: () => Promise<string>
}

/** Parsea Bridge config desde env vars. */
export function parseBridgeConfig(env: NodeJS.ProcessEnv) {
  return {
    user: (env['PROTON_BRIDGE_USER'] ?? '').trim(),
    pass: (env['PROTON_BRIDGE_PASS'] ?? '').trim(),
    passPath: env['PROTON_BRIDGE_PASS_PATH'] || undefined,
    host: env['PROTON_BRIDGE_HOST'] ?? '127.0.0.1',
    imapPort: Number(env['PROTON_BRIDGE_IMAP_PORT'] ?? 1143),
    smtpPort: Number(env['PROTON_BRIDGE_SMTP_PORT'] ?? 1025),
    from: (env['PROTON_MAIL_FROM'] ?? env['PROTON_BRIDGE_USER'] ?? '').trim(),
    tlsInsecure: (env['PROTON_BRIDGE_TLS_INSECURE'] ?? 'true') === 'true',
    ...(env['PROTON_BRIDGE_CA_PATH']
      ? { caPath: env['PROTON_BRIDGE_CA_PATH'] }
      : {}),
    smtpSecurity: (env['PROTON_BRIDGE_SMTP_SECURITY'] ?? 'starttls') as
      | 'starttls'
      | 'implicit'
      | 'plain',
  }
}
