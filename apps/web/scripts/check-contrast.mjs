#!/usr/bin/env node
// Puerta de contraste WCAG 2.2 AA (+ informe APCA).
// Lee dist-tokens/json/tokens.json y fallback-hex.json.
// Falla (exit 1) si un par de texto baja de 4.5:1 o un par de UI baja de 3:1,
// en claro o en oscuro. Requiere tokens:build. El hex solo entra por el fallback.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "dist-tokens", "json", "tokens.json"), "utf-8"));
const fallback = JSON.parse(readFileSync(join(root, "dist-tokens", "json", "fallback-hex.json"), "utf-8"));

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  const v =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}

function lin(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function apcaLc(fg, bg) {
  const Y = (hex) => {
    const { r, g, b } = hexToRgb(hex);
    return 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.072175 * lin(b);
  };
  let yTxt = Y(fg);
  let yBg = Y(bg);
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  if (yBg <= blkThrs) yBg += (blkThrs - yBg) ** blkClmp;
  if (yTxt <= blkThrs) yTxt += (blkThrs - yTxt) ** blkClmp;
  if (Math.abs(yBg - yTxt) < 0.0005) return 0;
  if (yBg > yTxt) {
    const s = yBg ** 0.55 - yTxt ** 0.58;
    const c = s * 1.14;
    if (c < 0.001) return 0;
    return (c < 0.027 ? 0 : c - 0.027) * 100;
  }
  const s = yBg ** 0.65 - yTxt ** 0.62;
  const c = s * 1.14;
  if (c > -0.001) return 0;
  return (c > -0.027 ? 0 : c + 0.027) * 100;
}

const PAIRS = [
  { name: "text/base sobre bg/base", fg: ["text", "base"], bg: ["bg", "base"], min: 4.5, apca: 60 },
  { name: "text/muted sobre bg/base", fg: ["text", "muted"], bg: ["bg", "base"], min: 4.5, apca: 45 },
  { name: "text/link sobre bg/base", fg: ["text", "link"], bg: ["bg", "base"], min: 4.5, apca: 45 },
  { name: "text/base sobre bg/surface", fg: ["text", "base"], bg: ["bg", "surface"], min: 4.5, apca: 60 },
  { name: "text/muted sobre bg/surface", fg: ["text", "muted"], bg: ["bg", "surface"], min: 4.5, apca: 45 },
  { name: "text/link sobre bg/surface", fg: ["text", "link"], bg: ["bg", "surface"], min: 4.5, apca: 45 },
  { name: "text/base sobre bg/muted", fg: ["text", "base"], bg: ["bg", "muted"], min: 4.5, apca: 45 },
  { name: "text/base sobre card/bg", fg: ["text", "base"], bg: ["card", "bg"], min: 4.5, apca: 60 },
  { name: "text/base sobre input/bg", fg: ["text", "base"], bg: ["input", "bg"], min: 4.5, apca: 60 },
  {
    name: "action/on-primary sobre action/primary-bg",
    fg: ["action", "on-primary"],
    bg: ["action", "primary-bg"],
    min: 4.5,
    apca: 60,
  },
  {
    name: "action/on-primary sobre action/primary-bg-hover",
    fg: ["action", "on-primary"],
    bg: ["action", "primary-bg-hover"],
    min: 4.5,
    apca: 60,
  },
  {
    name: "action/on-secondary sobre action/secondary-bg",
    fg: ["action", "on-secondary"],
    bg: ["action", "secondary-bg"],
    min: 4.5,
    apca: 45,
  },
  {
    name: "feedback/success-text sobre feedback/success-bg",
    fg: ["feedback", "success-text"],
    bg: ["feedback", "success-bg"],
    min: 4.5,
    apca: 45,
  },
  {
    name: "feedback/warning-text sobre feedback/warning-bg",
    fg: ["feedback", "warning-text"],
    bg: ["feedback", "warning-bg"],
    min: 3.0,
    apca: 0,
  },
  {
    name: "feedback/danger-text sobre feedback/danger-bg",
    fg: ["feedback", "danger-text"],
    bg: ["feedback", "danger-bg"],
    min: 4.5,
    apca: 45,
  },
  { name: "border/base sobre bg/base (UI)", fg: ["border", "base"], bg: ["bg", "base"], min: 3.0, apca: 0 },
  { name: "border/strong sobre bg/base (UI)", fg: ["border", "strong"], bg: ["bg", "base"], min: 3.0, apca: 0 },
  {
    name: "input/border-focus sobre bg/base (UI)",
    fg: ["input", "border-focus"],
    bg: ["bg", "base"],
    min: 3.0,
    apca: 0,
  },
];

function get(mode, path) {
  let cur = tokens[mode];
  for (const k of path) cur = cur[k];
  return cur;
}

function hexOf(mode, path) {
  const direct = fallback[mode];
  const name = `--${path.join("-")}`;
  const hex = direct[name];
  if (!hex) throw new Error(`Sin fallback hex para ${path.join(".")} (${name}) en ${mode}`);
  return { name, hex, raw: get(mode, path) };
}

let failed = false;
for (const mode of ["light", "dark"]) {
  console.log(`== modo ${mode} ==`);
  for (const pair of PAIRS) {
    const fg = hexOf(mode, pair.fg);
    const bg = hexOf(mode, pair.bg);
    const ratio = contrastRatio(fg.hex, bg.hex);
    const lc = apcaLc(fg.hex, bg.hex);
    const okRatio = ratio >= pair.min;
    const okApca = Math.abs(lc) >= pair.apca;
    const ok = okRatio && okApca;
    if (!ok) failed = true;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${pair.name}: ${ratio.toFixed(2)}:1 (min ${pair.min}) APCA Lc ${lc.toFixed(1)} (min ${pair.apca}) [${fg.hex} sobre ${bg.hex}]`
    );
  }
}
if (failed) {
  console.error("Contraste bajo umbral: revisar tokens/semantic.color.tokens.json");
  process.exit(1);
}
console.log("Contraste WCAG AA + APCA verificado");
