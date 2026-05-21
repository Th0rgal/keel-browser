#!/usr/bin/env bash
# Shared helpers. Source this from other scripts: `. "$(dirname "$0")/_lib.sh"`.
set -euo pipefail

KEEL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export KEEL_ROOT

# Colors (auto-off when not a TTY)
if [[ -t 1 ]] && [[ "${NO_COLOR:-}" == "" ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
  C_BLU=$'\033[34m'; C_MAG=$'\033[35m'; C_CYN=$'\033[36m'
  C_DIM=$'\033[2m'; C_BLD=$'\033[1m'; C_END=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_MAG=""; C_CYN=""; C_DIM=""; C_BLD=""; C_END=""
fi

log()    { printf '%s%s%s\n' "$C_CYN" "$*" "$C_END" >&2; }
ok()     { printf '%s✓%s %s\n' "$C_GRN" "$C_END" "$*" >&2; }
warn()   { printf '%s⚠%s %s\n' "$C_YEL" "$C_END" "$*" >&2; }
err()    { printf '%s✗%s %s\n' "$C_RED" "$C_END" "$*" >&2; }
die()    { err "$*"; exit 1; }
need()   { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }

# Detect platform
keel_platform() {
  case "$(uname -s)" in
    Linux)   echo "linux" ;;
    Darwin)  echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)       echo "unknown" ;;
  esac
}

# JSON read helper (jq required)
jq_get() { need jq; jq -r "$1" "$2"; }
