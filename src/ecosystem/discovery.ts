import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ECO_DISCOVERY_TIMEOUT_MS } from '../constants.js'
import { whichSync } from '../which.js'
import { REGISTRY, type BinaryInfo, type BinaryVersion } from './binaries.js'

export interface Subcommand {
  name: string
  description: string
}

export interface DiscoveryResult {
  version: BinaryVersion
  subcommands: Subcommand[]
  rawHelp: string
}

export function resolveBinPath(bin: BinaryInfo): string | undefined {
  if (bin.envVar) {
    const envPath = process.env[bin.envVar]
    if (envPath && existsSync(envPath)) return envPath
  }
  try {
    return whichSync(bin.defaultBin)
  } catch {
    return undefined
  }
}

export function checkBinary(bin: BinaryInfo): BinaryVersion {
  const path = resolveBinPath(bin)
  if (!path) {
    return {
      name: bin.name,
      product: bin.product,
      installed: false,
      inPath: false,
      error: `${bin.defaultBin} not found in PATH or ${bin.envVar ?? bin.defaultBin}`,
    }
  }

  let version: string | undefined
  try {
    const out = execFileSync(path, bin.versionCmd, {
      encoding: 'utf-8',
      timeout: ECO_DISCOVERY_TIMEOUT_MS,
    })
    version = out.trim().split('\n')[0] ?? undefined
  } catch {
    version = undefined
  }

  let authenticated: boolean | undefined
  if (bin.healthCmd) {
    try {
      execFileSync(path, bin.healthCmd, {
        encoding: 'utf-8',
        timeout: ECO_DISCOVERY_TIMEOUT_MS,
      })
      authenticated = true
    } catch {
      authenticated = false
    }
  }

  return {
    name: bin.name,
    product: bin.product,
    installed: true,
    ...(version !== undefined ? { version } : {}),
    ...(authenticated !== undefined ? { authenticated } : {}),
    inPath: true,
    path,
  }
}

export function checkAllBinaries(): BinaryVersion[] {
  return REGISTRY.map(checkBinary)
}

export function discoverSubcommands(bin: BinaryInfo): DiscoveryResult {
  const version = checkBinary(bin)

  if (!version.installed || !version.path) {
    return { version, subcommands: [], rawHelp: '' }
  }

  try {
    const out = execFileSync(version.path, ['--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    })
    const subcommands = parseHelpOutput(out, bin.product)
    return { version, subcommands, rawHelp: out }
  } catch {
    return { version, subcommands: [], rawHelp: '' }
  }
}

function parseHelpOutput(help: string, _product: string): Subcommand[] {
  const lines = help.split('\n')
  const subs: Subcommand[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    if (!line.startsWith('  ')) continue
    const match = /^\s{2}(\S+)\s+(.+)$/.exec(line)
    if (match) {
      const name = match[1] ?? ''
      if (!seen.has(name)) {
        seen.add(name)
        subs.push({
          name,
          description: (match[2] ?? '').trim(),
        })
      }
    }
  }

  if (subs.length === 0) {
    // Second pass: try to extract after "Commands:" header
    let inCommands = false
    for (const line of lines) {
      if (/^commands:/i.test(line.trim())) {
        inCommands = true
        continue
      }
      if (inCommands && line.trim()) {
        const m = /^(\S+)\s+(.+)$/.exec(line.trim())
        if (m) {
          const name = m[1] ?? ''
          if (!seen.has(name)) {
            seen.add(name)
            subs.push({ name, description: (m[2] ?? '').trim() })
          }
        }
      }
      if (inCommands && !line.trim()) inCommands = false
    }
  }

  return subs
}
