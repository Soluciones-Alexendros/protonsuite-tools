import { execFileSync } from 'node:child_process'
import { ECO_VERSION_TIMEOUT_MS } from '../constants.js'
import type { BinaryInfo } from './binaries.js'
import { checkBinary } from './discovery.js'

export interface UpdateCheckResult {
  product: string
  currentVersion?: string
  latestVersion?: string
  updatable: boolean
  error?: string
}

export function checkUpdateFor(bin: BinaryInfo): UpdateCheckResult {
  const local = checkBinary(bin)

  if (!local.installed || !local.version) {
    return {
      product: bin.product,
      ...(local.version !== undefined ? { currentVersion: local.version } : {}),
      updatable: false,
      error: local.error ?? 'not installed',
    }
  }

  const latest = fetchLatestVersion(bin)

  return {
    product: bin.product,
    currentVersion: local.version,
    ...(latest !== undefined ? { latestVersion: latest } : {}),
    updatable: latest !== undefined && local.version !== latest,
  }
}

function fetchLatestVersion(bin: BinaryInfo): string | undefined {
  switch (bin.product) {
    case 'drive':
    case 'gpg':
      return undefined
    case 'pass':
      try {
        const out = execFileSync(
          getPackageManager(),
          ['cache', 'policy', 'pass'],
          { encoding: 'utf-8', timeout: 10_000 },
        )
        const re = /Candidato:\s*(\S+)/
        const match = re.exec(out)
        return match?.[1] ?? undefined
      } catch {
        return undefined
      }
    case 'bridge':
      return undefined
  }
  return undefined
}

function getPackageManager(): string {
  try {
    execFileSync('apt', ['--version'], { encoding: 'utf-8', timeout: ECO_VERSION_TIMEOUT_MS })
    return 'apt'
  } catch {
    // fallback
  }
  try {
    execFileSync('pacman', ['--version'], { encoding: 'utf-8', timeout: ECO_VERSION_TIMEOUT_MS })
    return 'pacman'
  } catch {
    // fallback
  }
  return 'brew'
}
