#!/usr/bin/env bash
# Apply Keel patches with graceful fallback. Each patch is tried in turn;
# if it fails apply, it's logged and skipped. The final binary still gets
# the patches that did apply.
#
# This is the conservative path for "I just need a working Keel.deb".
# For strict mode (any patch failing aborts the build), use apply-patches.sh.

. "$(dirname "$0")/_lib.sh"
need git

TREE=""
while (( $# > 0 )); do
  case "$1" in
    --tree) TREE="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done
[[ -d "$TREE/.git" ]] || die "need --tree pointing at brave-core checkout"

shopt -s nullglob
PATCHES=( "$KEEL_ROOT"/patches/*.patch )

mkdir -p "$KEEL_ROOT/build"
STATUS_OUT="$KEEL_ROOT/build/patch_status.txt"
: > "$STATUS_OUT"
APPLIED=0
FAILED=0

cd "$TREE"
for p in "${PATCHES[@]}"; do
  name=$(basename "$p")
  if git apply --check --3way --whitespace=nowarn "$p" 2>/dev/null; then
    git apply --3way --whitespace=nowarn "$p" && {
      ok "applied: $name"
      echo "applied: $name" >> "$STATUS_OUT"
      APPLIED=$((APPLIED + 1))
    }
  else
    warn "skipped (won't apply cleanly): $name"
    echo "skipped: $name" >> "$STATUS_OUT"
    FAILED=$((FAILED + 1))
  fi
done

log "Result: $APPLIED applied, $FAILED skipped (see $STATUS_OUT)"
# Always succeed — caller decides whether to abort.
exit 0
