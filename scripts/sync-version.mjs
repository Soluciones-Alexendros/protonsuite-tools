#!/usr/bin/env node
/**
 * Regenera `src/version.ts` desde `package.json`.
 *
 * `package.json` es la fuente de verdad de la versión (semantic-release la
 * bumpa). Este script quema el valor en un módulo TS para que el runtime no
 * dependa de `node:fs` ni de la presencia de `package.json` junto al binario
 * (bundling seguro / binario único).
 *
 * Se ejecuta en:
 *  - `pnpm run version:sync` (manual).
 *  - `prebuild` (cada `pnpm build`).
 *  - `prepack` (cada `npm pack`/`npm publish`; tras el bump de semantic-release
 *    regenera y recompila para que el tarball publique la versión correcta).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const version = pkg.version
if (typeof version !== 'string' || version.length === 0) {
  console.error('[sync-version] package.json no tiene "version"')
  process.exit(1)
}

const out = `/**
 * Versión del servidor — GENERADA por scripts/sync-version.mjs.
 * NO editar a mano: \`pnpm run version:sync\` la regenera desde package.json.
 */
export const VERSION = '${version}'
`

writeFileSync(resolve(root, 'src/version.ts'), out, 'utf8')
console.log(`[sync-version] src/version.ts → ${version}`)
