#!/usr/bin/env node
// La UI no pinta hex ni oklch() sueltos, no llama a la red y declara lang=es.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(srcDir).filter((path) => !path.endsWith("generated-tokens.css"));
files.push(join(root, "index.html"));

const banned = [
  { name: "oklch suelto", re: /oklch\s*\(/i },
  { name: "hex suelto", re: /#[0-9a-f]{3,8}\b/i },
  { name: "fetch", re: /\bfetch\s*\(/ },
  { name: "innerHTML", re: /innerHTML/ },
  { name: "credencial de Bridge", re: /PROTON_BRIDGE_PASS|BEGIN PGP/ },
];

const failures = [];
let blob = "";
for (const path of files) {
  const text = readFileSync(path, "utf8");
  blob += text;
  for (const rule of banned) {
    if (rule.re.test(text)) failures.push(`${rule.name}: ${path}`);
  }
}

const html = readFileSync(join(root, "index.html"), "utf8");
if (!html.includes('lang="es"')) failures.push('index.html sin lang="es"');
if (!blob.includes("datos de ejemplo")) failures.push("falta la etiqueta «datos de ejemplo»");
if (!blob.includes("No se ejecuta")) failures.push("falta el aviso de dry-run");

if (failures.length > 0) {
  console.error("check-ui:");
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`check-ui: ${files.length} ficheros sin color suelto ni red`);
