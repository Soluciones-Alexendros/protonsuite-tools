import { execFileSync } from 'node:child_process'
import { ECO_APT_INSTALL_TIMEOUT_MS } from '../constants.js'
import { Platform, Codename } from '../which.js'
import type { BinaryInfo, InstallationGuide } from './binaries.js'
import { installationGuide } from './binaries.js'

export interface InstallResult {
  product: string
  ok: boolean
  message: string
  steps?: string[]
}

export function installOnUbuntu(bin: BinaryInfo): InstallResult {
  const product = bin.product
  if (product === 'pass') {
    return runApt(['install', 'pass', 'gpg', 'tree'])
  }
  if (product === 'gpg') {
    return runApt(['install', 'gnupg2'])
  }
  if (product === 'drive') {
    return {
      product,
      ok: false,
      message: `Descarga el binario proton-drive desde https://proton.me/support/drive-cli`,
      steps: [
        'wget -q https://proton.me/download/drive/cli/linux/proton-drive -O /usr/local/bin/proton-drive',
        'chmod +x /usr/local/bin/proton-drive',
        'proton-drive --version',
      ],
    }
  }
  // Bridge — último producto, siempre se ejecuta si llegamos aquí
  return {
    product,
    ok: false,
    message: 'Bridge requiere instalación manual del paquete oficial de Proton',
    steps: [
      'Descarga el .deb desde https://proton.me/mail/bridge',
      `Para Ubuntu ${Codename ?? '26.04'}: instala con dpkg -i protonmail-bridge*.deb`,
      'O usa el contenedor Docker: docker compose up -d proton-bridge',
    ],
  }
}

function runApt(args: string[]): InstallResult {
  try {
    execFileSync('sudo', ['apt', ...args, '-y'], {
      encoding: 'utf-8',
      timeout: ECO_APT_INSTALL_TIMEOUT_MS,
    })
    return {
      product: args[args.length - 1] ?? 'package',
      ok: true,
      message: `Installed via apt ${args.join(' ')}`,
    }
  } catch (err) {
    return {
      product: args[args.length - 1] ?? 'package',
      ok: false,
      message: (err as Error).message,
    }
  }
}

export function buildInstallPlan(bin: BinaryInfo): InstallResult {
  const guide: InstallationGuide = installationGuide(bin.product)
  return {
    product: bin.product,
    ok: false,
    message: `Installation of ${bin.name} requires manual steps`,
    steps: guide.steps,
  }
}

export function platformPackage(bin: BinaryInfo): string | null {
  if (Platform === 'arch') {
    if (bin.product === 'bridge') return 'protonmail-bridge-core'
    if (bin.product === 'pass') return 'pass'
    if (bin.product === 'gpg') return 'gnupg'
  }
  if (Platform === 'debian') {
    if (bin.product === 'pass') return 'pass'
    if (bin.product === 'gpg') return 'gnupg2'
  }
  if (Platform === 'macos') {
    if (bin.product === 'pass') return 'pass'
    if (bin.product === 'gpg') return 'gnupg'
  }
  return null
}
