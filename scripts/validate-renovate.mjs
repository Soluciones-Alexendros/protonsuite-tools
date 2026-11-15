#!/usr/bin/env node
/**
 * Valida `.github/renovate.json` sin red ni dependencias externas.
 *
 * Cubre las dos clases de fallo que han roto Renovate en este repo:
 *  1. **Preset que no resuelve** (issue #135): un `extends` del tipo
 *     `local>owner/repo:path` que apunta a un paquete inexistente. Renovate
 *     deja de abrir PRs hasta que se corrige, y el error solo aparece en su
 *     dashboard, no en CI.
 *  2. **Config que necesita migración**: formas obsoletas que Renovate
 *     reescribe (p. ej. `dependencyDashboard: true` →
 *     `{ enabled: true }`). `renovate-config-validator --strict` las marca
 *     como error, así que se detectan aquí antes de llegar al bot.
 *
 * Lo que NO hace: resolver presets remotos de verdad. Eso exige red y el
 * binario `renovate`, que en CI sería una dependencia sin pin (postura de
 * supply chain del repo). Para eso, en local:
 *
 *   npx --yes --package renovate renovate-config-validator --strict .github/renovate.json
 *
 * Uso: node scripts/validate-renovate.mjs [fichero]
 * Exit: 0 válido, 1 inválido.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] || ".github/renovate.json";
const src = readFileSync(file, "utf8");

let cfg;
try {
  if (file.endsWith(".json5")) {
    const { default: json5 } = await import("json5");
    cfg = json5.parse(src);
  } else {
    cfg = JSON.parse(src);
  }
} catch (e) {
  console.error(`INVALID ${file}: ${e.message}`);
  process.exit(1);
}

const errors = [];

// --- 1. Presets -----------------------------------------------------------
const presets = Array.isArray(cfg.extends)
  ? cfg.extends
  : cfg.extends
    ? [cfg.extends]
    : [];

for (const preset of presets) {
  if (typeof preset !== "string") {
    errors.push(`extends contiene una entrada no-string: ${JSON.stringify(preset)}`);
    continue;
  }
  // `local>` resuelve contra un repo de la plataforma, no contra npm: un
  // typo o un repo renombrado lo rompen en silencio.
  if (preset.startsWith("local>")) {
    errors.push(
      `extends usa un preset local que puede no existir: "${preset}". ` +
        `Si el repo o el path cambió, Renovate deja de abrir PRs (issue #135). ` +
        `Verifícalo o sustitúyelo por un preset built-in (config:recommended).`,
    );
  }
  // Un preset built-in siempre existe; los demás (github>, npm>, …) dependen
  // de un tercero y no se pueden validar sin red: se aceptan tal cual.
}

// --- 2. Formas que necesitan migración -----------------------------------
if (typeof cfg.dependencyDashboard === "boolean") {
  errors.push(
    `dependencyDashboard es booleano; la forma vigente es ` +
      `{ "enabled": <bool> }. Renovate la migra y --strict la marca como error.`,
  );
}

if (cfg.dependencyDashboardHeader !== undefined) {
  errors.push(
    `dependencyDashboardHeader está deprecado; muévelo a ` +
      `dependencyDashboardHeader dentro de dependencyDashboard.`,
  );
}

for (const [i, rule] of (cfg.packageRules ?? []).entries()) {
  if (typeof rule.dependencyDashboard === "boolean") {
    errors.push(
      `packageRules[${i}].dependencyDashboard es booleano; usa { "enabled": <bool> }.`,
    );
  }
}

// --- Resultado -----------------------------------------------------------
if (errors.length > 0) {
  console.error(`INVALID ${file}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const rules = cfg.packageRules?.length ?? 0;
console.log(
  `VALID: ${file} (${src.split("\n").length} lines, ` +
    `${Object.keys(cfg).length} top-level keys, ${rules} packageRules)`,
);
