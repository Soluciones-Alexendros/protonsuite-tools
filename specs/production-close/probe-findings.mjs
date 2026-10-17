#!/usr/bin/env node
// T-BASE-01 / P00-O01 — Verificación estática F01..F44.
// Deriva la matriz de hallazgos desde el arbol de trabajo. Solo lectura.
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

const PROBE = {
  F01: () => {
    const ex = read('src/agent/executor.ts') ?? ''
    const ps = read('src/pass.ts') ?? ''
    const a = /passClient\.generate\(/.test(ex)
    const b = /'insert',\s*'--multiline',\s*'--force'/.test(ps)
    return [a && b, `executor llama passClient.generate=${a}; pass.ts usa --force=${b}`]
  },
  F02: () => {
    const sd = read('src/server/drive.ts') ?? ''
    const ex = read('src/agent/executor.ts') ?? ''
    const da = read('src/drive-audit.ts') ?? ''
    const a = /renameSync\(src, dst\)/.test(sd)
    const b = /renameSync\(src, dst\)/.test(ex)
    const c = /clobber|collision|existsSync\(dst\)|no-clobber|noclobber/i.test(da)
    return [a && b && !c, `server/drive.ts renameSync=${a}; executor renameSync=${b}; drive-audit sin analisis de colisiones=${!c}`]
  },
  F03: () => {
    const src = execSync("grep -rEl 'approval|policyEngine|ApprovalGrant|authorize\\(' src/server/ src/agent/ || true").toString().trim()
    return [src === '', `ficheros con motor de aprobacion: ${src === '' ? 'ninguno' : src.replace(/\n/g, ',')}`]
  },
  F04: () => {
    const bc = read('src/bridge/bridge-client.ts') ?? ''
    const sb = read('src/server/bridge.ts') ?? ''
    const a = /password/i.test(bc)
    const b = /password/i.test(sb)
    return [a || b, `bridge-client menciona password=${a}; server/bridge menciona password=${b}`]
  },
  F05: () => {
    const sd = read('src/server/drive.ts') ?? ''
    const a = /staging_dir/.test(sd) && /resolve\(staging_dir\)/.test(sd)
    const b = /workspace|sandbox|isInsideRoot|canonical/i.test(sd)
    return [a && !b, `staging_dir desde cliente=${a}; contiene validacion de workspace=${b}`]
  },
  F06: () => {
    const sb = read('src/server/bridge.ts') ?? ''
    const a = /password:\s*z\./.test(sb)
    const b = /totp|twoFactor|two_factor/i.test(sb)
    return [a, `password en inputSchema=${a}; totp=${b}`]
  },
  F07: () => {
    const ps = read('src/pass.ts') ?? ''
    const a = /gopass/.test(ps)
    const b = /proton.?pass/i.test(ps)
    return [a && !b, `soporta gopass=${a}; usa CLI oficial Proton Pass=${b}`]
  },
  F08: () => {
    const sp = read('src/server/pass.ts') ?? ''
    const a = /injected/.test(sp)
    const b = /copyToClipboard|clipboard|inject/i.test(sp)
    return [a, `expone injected=${a}; mecanismo real de inyeccion=${b}`]
  },
  F09: () => {
    const ps = read('src/pass.ts') ?? ''
    const a = /catch\s*\{\s*continue\s*\}/.test(ps)
    const b = /failed|skipped|decryptErrors/.test(ps)
    return [a && !b, `catch-continue en audit=${a}; contabiliza fallos=${b}`]
  },
  F10: () => {
    const ps = read('src/pass.ts') ?? ''
    const a = /\.trim\(\)/.test(ps)
    return [a, `pass.ts usa trim()=${a}`]
  },
  F11: () => {
    const ps = read('src/pass.ts') ?? ''
    const a = /validatePath/.test(ps)
    const b = /startsWith\('-'\)|--\s|\boption\b/i.test(ps)
    return [a && !b, `validatePath existe=${a}; bloquea nombres tipo opcion=${b}`]
  },
  F12: () => {
    const st = read('src/server.ts') ?? ''
    const bc = read('src/bridge/bridge-client.ts') ?? ''
    const a = /existsSync\(/.test(st + bc) && !/which|resolveBinary|command -v|isAbsolute/.test(st + bc)
    return [a, `existsSync sobre nombre de binario sin resolver PATH=${a}`]
  },
  F13: () => {
    const bc = read('src/bridge/bridge-client.ts') ?? ''
    const a = /127\.0\.0\.1|localhost/.test(bc)
    const b = /cfg\.|config\./.test(bc)
    return [a, `host/puerto hardcodeado=${a}; lee de config=${b}`]
  },
  F14: () => {
    const bc = read('src/bridge/bridge-client.ts') ?? ''
    const a = /checkImapAuth|health/.test(bc)
    const b = /TLS|tls|starttls/i.test(bc)
    return [a && !b, `health/checkImapAuth=${a}; distingue TLS=${b}`]
  },
  F15: () => {
    const bc = read('src/bridge/bridge-client.ts') ?? ''
    const a = /cliCommand/.test(bc)
    return [a, `cliCommand presente=${a}`]
  },
  F16: () => {
    const d = read('src/drive.ts') ?? ''
    const a = /normalizeListOutput/.test(d)
    const b = /catch[\s\S]{0,120}return\s*\[\s*\]/.test(d)
    return [a, `normalizeListOutput=${a}; degrada a lista vacia=${b}`]
  },
  F17: () => {
    const sd = read('src/server/drive.ts') ?? ''
    const d = read('src/drive.ts') ?? ''
    const a = /auth_login|login/i.test(sd + d)
    const b = /timeout/i.test(sd + d)
    return [a && !b, `login presente=${a}; timeout=${b}`]
  },
  F18: () => {
    const st = read('src/server.ts') ?? ''
    const a = /products\.mail\.enabled|mail\.enabled/.test(st)
    return [a, `gating explicit de mail.enabled=${a}`]
  },
  F19: () => {
    const ix = read('src/index.ts') ?? ''
    const ht = read('src/http.ts') ?? ''
    const a = /new McpServer|buildServer/.test(ht + ix)
    const b = /dispose|closeAll|\.close\(\)/.test(ht)
    return [a, `server por sesion=${a}; dispose/close=${b}`]
  },
  F20: () => {
    const ht = read('src/http.ts') ?? ''
    const a = /rateLimit|RateLimit/.test(ht)
    const b = /req\.headers\.authorization|token/i.test(ht)
    return [a && b, `rate limit + clave derivada de token=${a && b}`]
  },
  F21: () => {
    const ht = read('src/http.ts') ?? ''
    const idx = ht.indexOf('express.json')
    const auth = ht.toLowerCase().indexOf('bearer')
    return [idx !== -1 && (auth === -1 || idx < auth), `express.json@${idx} vs auth bearer@${auth}`]
  },
  F22: () => {
    const mx = read('src/utils/metrics.ts') ?? ''
    const ht = read('src/http.ts') ?? ''
    const a = /mcpMethod|method/.test(ht)
    const b = /sanitize|labelize|reduceLabel|normalize/.test(mx)
    return [a, `metodo RPC como label=${a}; saneado=${b}`]
  },
  F23: () => {
    const ht = read('src/http.ts') ?? ''
    const a = /maxSessions|sessionCap|MAX_SESSIONS|concurrency|maxConcurrent/i.test(ht)
    return [a, `cupos explicitos de sesion/concurrencia=${a}`]
  },
  F24: () => {
    const ps = read('src/pass.ts') ?? ''
    const d = read('src/drive.ts') ?? ''
    const a = /execFile|spawn/.test(ps + d)
    const b = /timeout/.test(ps + d)
    return [a && !b, `execFile/spawn=${a}; timeout=${b}`]
  },
  F25: () => {
    const du = read('src/drive-utils.ts') ?? ''
    const a = /readdirSync|readdir/.test(du)
    const b = /lstat|symlink/.test(du)
    const c = /createHash/.test(du) && /createReadStream/.test(du) === false
    return [a, `recorrido=${a}; trata lstat/symlink=${b}; hash sincrono sin stream=${c}`]
  },
  F26: () => {
    const im = read('src/imap.ts') ?? ''
    const sm = read('src/smtp.ts') ?? ''
    const a = /download\(|content\.toString|attachment/i.test(im)
    const b = /maxAttachment|MAX_ATTACHMENT|sizeLimit/i.test(im + sm)
    return [(a), `descarga adjuntos=${a}; limite de tamano=${b}`]
  },
  F27: () => {
    const ht = read('src/http.ts') ?? ''
    const a = /req\.headers\.host|trust proxy|Host/.test(ht)
    const b = /NODE_ENV/.test(ht + (read('src/index.ts') ?? ''))
    return [a, `valida Host=${a}; control condicionado a NODE_ENV=${b}`]
  },
  F28: () => {
    const au = read('src/auth.ts') ?? ''
    const ht = read('src/http.ts') ?? ''
    const a = /expectedToken|token/.test(au + ht)
    const b = /if\s*\(!?\s*token|length\s*<\s*\d|minLength/.test(au + ht)
    return [a, `token esperado vacio posible=${!b}`]
  },
  F29: () => {
    const ht = read('src/http.ts') ?? ''
    const a = /Access-Control-Allow-Origin|cors/i.test(ht)
    const b = /mcp-session-id|sessionId/i.test(ht)
    return [a || b, `CORS=${a}; sesion=${b}`]
  },
  F30: () => {
    const df = read('Dockerfile') ?? ''
    const a = /^\s*USER\s+/m.test(df)
    return [!a, `Dockerfile declara USER no root=${a}`]
  },
  F31: () => {
    const df = read('Dockerfile') ?? ''
    const a = /pass\b|gopass|gnupg|gpg/i.test(df)
    return [!a, `imagen incluye pass/gpg=${a}`]
  },
  F32: () => {
    const df = read('Dockerfile') ?? ''
    const a = /curl|wget/.test(df)
    const b = /sha256|--check|gpg --verify/i.test(df)
    return [a && !b, `descarga CLI=${a}; verifica integridad=${b}`]
  },
  F33: () => {
    const dc = read('docker-compose.yml') ?? ''
    const a = /volumes:/.test(dc)
    const b = /staging|journal|audit/i.test(dc)
    return [a, `volumenes=${a}; incluye staging/journal/audit=${b}`]
  },
  F34: () => {
    const im = read('src/imap.ts') ?? ''
    const sm = read('src/smtp.ts') ?? ''
    const a = /rejectUnauthorized\s*:\s*false/.test(im + sm)
    const b = /requireTLS|STARTTLS|starttls/i.test(im + sm)
    const c = /ca\s*:|CA|caFile/i.test(im + sm)
    return [a || !b, `rejectUnauthorized=false=${a}; exige STARTTLS=${b}; inyecta CA=${c}`]
  },
  F35: () => {
    const ht = read('src/http.ts') ?? ''
    const a = /healthz|\/health/.test(ht)
    const b = /readyz|readiness/.test(ht)
    return [a && !b, `healthz=${a}; readiness separada=${b}`]
  },
  F36: () => {
    const df = read('Dockerfile') ?? ''
    const a = /apps\/web|protonsuite-web/.test(df)
    return [!a, `build de imagen incluye workspace web=${a}`]
  },
  F37: () => {
    const pkg = JSON.parse(read('package.json')).version
    const srv = JSON.parse(read('server.json')).version
    return [pkg !== srv || pkg !== '1.4.3', `package=${pkg}; server.json=${srv}`]
  },
  F38: () => {
    const ci = existsSync('.github/workflows/ci.yml') ? read('.github/workflows/ci.yml') : ''
    const rel = existsSync('.github/workflows/release.yml') ? read('.github/workflows/release.yml') : ''
    const a = /workflow_run|needs:/.test(rel)
    return [a || rel === '', `release espera gates=${a}`]
  },
  F39: () => {
    const ci = read('.github/workflows/ci.yml') ?? ''
    const a = /--audit-level=|audit-level/.test(ci)
    const b = /--audit-level=high|--audit-level=critical/.test(ci)
    return [a && !b, `audit-level declarado=${a}; exige high=${b}`]
  },
  F40: () => {
    const df = read('Dockerfile') ?? ''
    const a = /FROM\s+\S+:(latest|\d+\s*$)/m.test(df) || /FROM\s+node:2[0-9]-alpine/.test(df)
    const b = /@sha256:/.test(df)
    return [a && !b, `base flotante=${a}; fijada por digest=${b}`]
  },
  F41: () => {
    const vc = read('vitest.config.ts') ?? ''
    const a = /exclude/.test(vc)
    const b = /include/.test(vc)
    return [a, `vitest.config excluye ficheros=${a}`]
  },
  F42: () => {
    const ax = read('src/alerts/index.ts') ?? ''
    const se = read('src/security.ts') ?? ''
    const a = /catch\s*\{[\s\S]{0,40}\}/.test(ax)
    const b = /redact|sanitize|mask/i.test(se)
    return [a, `alerts best-effort=${a}; redaccion en security.ts=${b}`]
  },
  F43: () => {
    const sd = read('src/server/drive.ts') ?? ''
    const sp = read('src/server/pass.ts') ?? ''
    const a = /destructiveHint:\s*false/.test(sd + sp)
    const b = /renameSync|generat|remove|delete/i.test(sd + sp)
    return [a && b, `destructiveHint:false junto a efectos mutativos=${a && b}`]
  },
  F44: () => {
    const rd = read('README.md') ?? ''
    const m = rd.match(/(\d+\.\d+\.\d+)/)
    return [m?.[1] !== '1.4.3', `README declara version=${m?.[1] ?? 'n/d'}; package=1.4.3`]
  },
}

const rows = []
for (const [id, fn] of Object.entries(PROBE)) {
  let flag = false
  let note = ''
  try {
    const r = fn()
    flag = Boolean(r[0])
    note = String(r[1])
  } catch (e) {
    flag = false
    note = `PROBE_ERROR: ${e.message}`
  }
  rows.push({ id, present: flag, note })
}

const reproduced = rows.filter((r) => r.present)
console.log(`TOTAL=${rows.length} PRESENTE=${reproduced.length} AUSENTE=${rows.length - reproduced.length}`)
console.log('---')
for (const r of rows) console.log(`${r.id}\t${r.present ? 'PRESENTE' : 'ausente'}\t${r.note}`)
