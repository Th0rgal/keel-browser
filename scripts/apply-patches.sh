#!/usr/bin/env bash
# Apply the Keel patch stack to an upstream Brave checkout.
#
# Usage:
#   scripts/apply-patches.sh                       apply to ./upstream/brave-browser
#   scripts/apply-patches.sh --check               dry-run
#   scripts/apply-patches.sh --tree ../brave       apply to specific tree
#   scripts/apply-patches.sh --only 0001 0003      apply only listed patches
#
# Outputs the patch_status (clean|conflict|skipped) into build/keel.json so
# scripts/security-lag.sh can read it.

. "$(dirname "$0")/_lib.sh"
need git

TREE="$KEEL_ROOT/upstream/brave-browser"
CHECK=0
ONLY=()

while (( $# > 0 )); do
  case "$1" in
    --check) CHECK=1; shift ;;
    --tree)  TREE="$2"; shift 2 ;;
    --only)  shift; while [[ $# -gt 0 && ! "$1" =~ ^-- ]]; do ONLY+=("$1"); shift; done ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -d "$TREE/.git" ]] || die "no git tree at $TREE — run scripts/clone-upstream.sh or pass --tree"

shopt -s nullglob
PATCHES=( "$KEEL_ROOT"/patches/*.patch )
[[ ${#PATCHES[@]} -gt 0 ]] || die "no patches in $KEEL_ROOT/patches/"

filter_only() {
  if (( ${#ONLY[@]} == 0 )); then printf '%s\n' "${PATCHES[@]}"; return; fi
  for p in "${PATCHES[@]}"; do
    for o in "${ONLY[@]}"; do [[ "$(basename "$p")" == "$o"* ]] && echo "$p"; done
  done
}

APPLY="apply"
[[ "$CHECK" -eq 1 ]] && APPLY="apply --check"

STATUS="clean"
mapfile -t TO_APPLY < <(filter_only)

(
  cd "$TREE"
  for p in "${TO_APPLY[@]}"; do
    name=$(basename "$p")
    if git $APPLY --3way --whitespace=nowarn "$p" 2>/dev/null; then
      ok "$name"
    else
      err "$name failed to apply"
      STATUS="conflict"
      git $APPLY --3way --whitespace=nowarn "$p" || true
    fi
  done
  echo "$STATUS" > "$KEEL_ROOT/build/.patch_status"
)

mkdir -p "$KEEL_ROOT/build"
echo "$(cat "$KEEL_ROOT/build/.patch_status" 2>/dev/null || echo unknown)" > "$KEEL_ROOT/build/patch_status.txt"
[[ "$STATUS" == "clean" ]] && ok "All patches applied cleanly." || die "Patch stack has conflicts."
