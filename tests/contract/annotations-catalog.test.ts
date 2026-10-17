/**
 * Contrato: las `annotations` que ve el cliente tienen que decir la verdad.
 *
 * Las anotaciones son un hint para el cliente. Antes se escribían a mano y
 * estaban mal en varios sitios (F43): `proton_calendar_create_event` se
 * declaraba de solo lectura y creaba eventos; `proton_drive_copy` igual y
 * copiaba ficheros.
 *
 * Este test compara lo que publica el servidor con el catálogo de efectos. Si
 * alguien añade o cambia una herramienta y su anotación no cuadra con la clase
 * declarada, falla aquí en vez de descubrirse en producción.
 */
import { describe, it, expect, vi } from 'vitest'
import { hintsFor, TOOL_EFFECTS } from '../../src/authz/index.js'
import { listContractTools, makeContractCfg } from './helpers.js'

vi.mock('../../src/imap.js', () => ({
  ImapClient: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../src/smtp.js', () => ({
  SmtpClient: vi.fn().mockImplementation(() => ({})),
  buildReplyOptions: vi.fn(),
  buildForwardOptions: vi.fn(),
}))
vi.mock('../../src/pass.js', () => ({
  PassClient: vi.fn().mockImplementation(() => ({ getBackendBinary: () => 'pass' })),
}))
vi.mock('../../src/drive.js', () => ({
  DriveClient: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../src/bridge/bridge-client.js', () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({})),
}))

describe('contrato · anotaciones frente al catálogo de efectos', () => {
  it('cada herramienta publicada tiene una entrada en el catálogo', async () => {
    const tools = await listContractTools()
    const sinDeclarar = tools
      .map((t) => t.name)
      .filter((name) => !(name in TOOL_EFFECTS))

    // Si aparece algo aquí, la política lo denegaría por defecto. Se ve en el
    // test en vez de en un «denegado» inesperado en producción.
    expect(sinDeclarar).toEqual([])
  })

  it('no hay entradas de catálogo para herramientas que ya no existen', async () => {
    const tools = await listContractTools()
    const publicadas = new Set(tools.map((t) => t.name))
    const huerfanas = Object.keys(TOOL_EFFECTS).filter((n) => !publicadas.has(n))

    // Puede haberlas legítimamente (Calendar experimental está oculto por
    // defecto), pero conviene saber cuáles.
    expect(huerfanas.sort()).toEqual([
      'proton_calendar_create_event',
      'proton_calendar_list_calendars',
      'proton_calendar_list_events',
    ])
  })

  /** Perfil por defecto y perfil con Calendar experimental, ambos medidos. */
  const perfiles = async () => [
    ...(await listContractTools()),
    ...(await listContractTools({
      products: {
        ...makeContractCfg().products,
        calendar: { enabled: true, experimental: true },
      },
    })),
  ]

  it('readOnlyHint coincide con la clase declarada', async () => {
    const tools = await perfiles()
    const mentiras: string[] = []

    for (const tool of tools) {
      const effect = TOOL_EFFECTS[tool.name]
      if (!effect) continue
      const declarado = tool.annotations?.['readOnlyHint']
      if (declarado === undefined) continue
      const esperado = hintsFor(effect.effectClass).readOnlyHint
      if (declarado !== esperado) {
        mentiras.push(
          `${tool.name}: declara readOnlyHint=${String(declarado)} pero su clase es ${effect.effectClass}`,
        )
      }
    }

    expect(mentiras).toEqual([])
  })

  it('destructiveHint coincide con la clase declarada', async () => {
    const tools = await perfiles()
    const mentiras: string[] = []

    for (const tool of tools) {
      const effect = TOOL_EFFECTS[tool.name]
      if (!effect) continue
      const declarado = tool.annotations?.['destructiveHint']
      if (declarado === undefined) continue
      const esperado = hintsFor(effect.effectClass).destructiveHint
      if (declarado !== esperado) {
        mentiras.push(
          `${tool.name}: declara destructiveHint=${String(declarado)} pero su clase es ${effect.effectClass}`,
        )
      }
    }

    expect(mentiras).toEqual([])
  })
})
