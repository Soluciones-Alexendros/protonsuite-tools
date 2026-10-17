#!/usr/bin/env bash
# T-BASE-01 — Captura de baseline. Solo lectura sobre el codigo fuente.
# Registra exit code, duracion y hash por gate. Nunca usa '|| true' para blanquear.
set -uo pipefail

REPO_ROOT="${1:?uso: run-baseline.sh <repo_root>}"
OUT_DIR="${2:?uso: run-baseline.sh <repo_root> <out_dir>}"
LOG="${OUT_DIR}/baseline-gates.log"
JSON="${OUT_DIR}/baseline-receipt.json"
mkdir -p "${OUT_DIR}"

cd "$REPO_ROOT" || exit 2

gate() {
  local name="$1"; shift
  local start end rc dur
  start=$(date +%s.%N)
  {
    echo "----- GATE ${name} :: $(date -Is) -----"
    echo "$ $*"
  } >>"$LOG"
  "$@" >>"$LOG" 2>&1
  rc=$?
  end=$(date +%s.%N)
  dur=$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')
  echo "GATE ${name} exit=${rc} dur=${dur}s" | tee -a "$LOG"
  printf '%s\t%s\t%s\n' "$name" "$rc" "$dur" >>"${OUT_DIR}/gates.tsv"
}

: >"$LOG"
: >"${OUT_DIR}/gates.tsv"

{
  echo "# Baseline receipt T-BASE-01"
  echo "repo=$(pwd)"
  echo "head=$(git rev-parse HEAD)"
  echo "head_tree=$(git rev-parse HEAD^{tree})"
  echo "origin_main=$(git rev-parse origin/main)"
  echo "origin_main_tree=$(git rev-parse origin/main^{tree})"
  echo "branch=$(git branch --show-current)"
  echo "dirty=$(git status --porcelain | wc -l)"
  echo "lockfile_sha256=$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
  echo "node=$(node -v)"
  echo "pnpm=$(pnpm -v)"
  echo "started=$(date -Is)"
} | tee -a "$LOG"

gate rev-parse-head            git rev-parse HEAD
gate status-porcelain          git status --porcelain
gate install-frozen            pnpm install --frozen-lockfile
gate lint                      pnpm run lint
gate typecheck                 pnpm run typecheck
gate test                     pnpm test
gate build                     pnpm run build
gate test-contract             pnpm run test:contract
gate smoke                     pnpm run smoke
gate coverage                  pnpm run coverage
gate docs-generate             pnpm run docs:generate
gate docs-check                pnpm run docs:check

echo "ended=$(date -Is)" | tee -a "$LOG"

{
  echo "{"
  echo "  \"schemaVersion\": 1,"
  echo "  \"evidenceId\": \"E-T-BASE-01-baseline\","
  echo "  \"testId\": \"T-BASE-01\","
  echo "  \"sourceSha\": \"$(git rev-parse HEAD)\","
  echo "  \"sourceTree\": \"$(git rev-parse HEAD^{tree})\","
  echo "  \"lockfileSha256\": \"$(sha256sum pnpm-lock.yaml | awk '{print $1}')\","
  echo "  \"gates\": ["
  awk -F'\t' '{printf "    {\"name\": \"%s\", \"exitCode\": %s, \"durationSeconds\": %s}%s\n", $1, $2, $3, (NR==FNR?"":","); }' "${OUT_DIR}/gates.tsv" | sed '$ s/,$//'
  echo "  ]"
  echo "}"
} >"$JSON"

echo "receipt=${JSON}"
