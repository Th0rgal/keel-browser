# Keel Dev Loop

How to iterate on Keel without paying the full Brave + Chromium build cost every time.

## TL;DR

```
First time:         3-6 hours, ~80 GB disk    (one-time cost)
Iterate on a patch: 5-30 seconds              (incremental rebuild)
Iterate on newtab:  0 seconds                 (DevTools live-edit on chrome://newtab)
Rebase to next Brave Stable: 2-15 minutes     (incremental relink + patch fixups)
```

## One-time setup

### 1. Install host deps

```sh
apt-get install -y python3 git curl ninja-build gperf lsb-release build-essential
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.config/nvm/nvm.sh
nvm install 24            # Brave 1.90+ requires Node 24
```

Brave's own `install-build-deps.sh` (run automatically by `npm run init`) pulls the OS-level deps for Chromium itself.

### 2. Install ccache

[`ccache`](https://ccache.dev/) is the iteration multiplier — it caches compiled object files keyed by preprocessed source hash. Without it, every clean build is a cold build.

We use **ccache** rather than sccache because sccache rejects ~90% of Chromium's compile calls (it can't parse Chromium's `-Xclang find-bad-constructs` plugin args, even with `clang_use_chrome_plugins=false`). ccache passes everything through transparently — verified 100% cacheable in the v0.1.0-prerelease build.

```sh
sudo apt-get install -y ccache
mkdir -p ~/.cache/ccache
export CCACHE_DIR=~/.cache/ccache
ccache --set-config max_size=40G
```

Set `CCACHE_DIR` in your shell rc so every shell gets it.

### 3. Restore the prebuilt cache (optional but recommended)

We ship a tarball of the ccache directory with every Keel release. Download it once and you skip the 3-6h cold build.

```sh
# In a fresh setup
gh release download v0.1.0-prerelease --repo Th0rgal/keel-browser --pattern 'ccache-cache.tar.zst'
mkdir -p $CCACHE_DIR && zstd -d ccache-cache.tar.zst -c | tar -x -C $CCACHE_DIR
ccache -s
```

After the restore, the next clean build is a chain of cache hits — typically 5-15 minutes instead of 3-6 hours.

### 4. Sync the Brave source

```sh
mkdir -p ~/keel-build && cd ~/keel-build
git clone -b v1.90.124 https://github.com/brave/brave-core.git src/brave
cd src/brave
npm install
npm run init        # ~30-60 minutes, ~30 GB download
```

### 5. Apply Keel patches

From the keel-browser repo:

```sh
scripts/apply-patches.sh --tree ~/keel-build/src/brave --check
scripts/apply-patches.sh --tree ~/keel-build/src/brave
```

Line numbers drift between Brave releases. If `--check` fails, fix the patch (not the tree) and re-run.

### 6. Write build args

```sh
cat > ~/keel-build/src/out/Component/args.gn <<'EOF'
# Dev iteration mode: per-subdir .so so incremental relinks are seconds.
import("//brave/build/args/dev.gni")
target_cpu = "x64"

is_component_build = true
is_debug = false
symbol_level = 1
dcheck_always_on = true

use_remoteexec = false
cc_wrapper = "sccache"

# Keel-specific
build_brave_thin = true
EOF

cd ~/keel-build/src
gn gen out/Component
```

For a release-quality binary instead, swap to `out/Release` with `is_component_build=false`, `is_official_build=true`. Slower compile, smaller cache benefit, but you get a real `.deb`.

## Daily inner loop

### Touching a UI patch (Views C++)

```sh
$ vi src/brave/browser/ui/views/keel/keel_minimal_toolbar.cc
$ autoninja -C src/out/Component chrome
# … 5-30 seconds typically …
$ src/out/Component/brave --user-data-dir=/tmp/keel-test
```

`autoninja` knows which files changed and only recompiles those + their dependents. sccache catches anything that's semantically identical to a previously-compiled file (across builds).

### Touching the new tab page (HTML/CSS/JS)

```sh
# Brave is running in a separate terminal
$ vi newtab/index.html        # in keel-browser repo
# In the browser: chrome://newtab → Ctrl+Shift+I → Sources panel
# Edit live, see the change instantly. No rebuild.
```

For the changes to persist into the next build, also `scripts/apply-patches.sh` and rebuild — but for design iteration the DevTools loop is the right one.

### Touching policies / `master_preferences`

```sh
$ vi policies/linux/keel-managed-policy.json
$ sudo bash scripts/install-policy.sh
$ pkill brave    # restart Brave so it re-reads the policy
$ brave
```

No build needed at all.

### Rebasing onto the next Brave Stable

```sh
$ scripts/sync-upstream.sh         # updates build/upstream.json
$ scripts/clone-upstream.sh        # (or just cd src/brave && git fetch && git checkout new-tag)
$ cd src/brave && npm run sync     # re-sync deps for the new tag
$ scripts/apply-patches.sh --check
$ # fix any patch that didn't apply
$ scripts/apply-patches.sh
$ cd .. && autoninja -C out/Component chrome
# … ~5-15 minutes if sccache cache is warm and no big Chromium churn …
```

`scripts/security-lag.sh` reports your lag against upstream at every step.

## "What recompiles when I touch X" cheat sheet

| Edit | Recompile target | Typical time |
|---|---|---|
| `chrome/browser/ui/views/tabs/tab.cc` | `chrome` target, single .so in component build | 5-10 s |
| `brave/browser/ui/views/keel/keel_minimal_toolbar.cc` | `keel_views` source_set | 5-15 s |
| `brave/browser/ui/keel/keel_tab_accent.cc` | `keel_tab_accent` source_set | 5-15 s |
| `brave/app/brave_strings.grdp` | grd build + relink | 30-60 s |
| `chrome/browser/resources/keel_newtab/*` | webui_bundle | 10-30 s |
| `policies/*.json` | nothing | 0 s (just restart Brave) |
| `theme/tokens.json` | nothing automatically — patches need to re-encode the values | depends |

## Pushing changes back to a Keel release

1. Bump `build/keel.json` (`keel_version`, `pinned_at`)
2. `scripts/security-lag.sh` — should still show lag 0h
3. `git tag -a v0.1.1-keel.x` + push
4. The `build` CI workflow's `source-build` job runs `apply-patches.sh + autoninja`, builds the `.deb`, packages the sccache cache, uploads both to the release.

## Why component build for daily work

| Mode | First clean build | Touching one file | Final binary suitable for shipping? |
|---|---|---|---|
| `is_component_build=true` (default for dev) | ~3-4 h cold, ~5-15 min warm-cache | **5-30 s** | No — needs the build tree to run |
| `is_component_build=false, is_official_build=true` (release) | ~5-7 h cold, ~30-60 min warm-cache | 30 s - 5 min | Yes — gives a real `.deb` |

Component build wins the daily loop. Release build wins the release artifact. We run release in CI on tags.

## Why sccache wins even with no remote

Even a purely-local sccache helps because:

1. You'll run `gn clean` more often than you think (config changes, GN regen, etc.) — without sccache, every gn clean is a 4-hour reset. With it, ~10-15 min.
2. Multiple `out/` dirs (Component, Release, Test) share the same cache. The second one is essentially free.
3. Rebasing onto a new Brave that touches a few hundred Chromium files: those files would be a full recompile without sccache. With it, only the truly-new files miss the cache.

Even rough numbers: sccache typical hit rate on the second build of a Keel checkout is 85-95%.

## Cache hygiene

`sccache` grows to its configured `SCCACHE_CACHE_SIZE` and then evicts old entries LRU.

```sh
sccache --show-stats        # inspect hit rate, cache size
sccache --zero-stats        # reset counters (cache stays)
SCCACHE_CACHE_SIZE=80G \
  sccache --start-server    # bump max cache size
```

When the cache reaches 40 GB and starts to evict, the hit rate may dip until the working set stabilizes. Don't aggressively prune.

## What the release ships

The `v0.1.0-prerelease` GitHub release contains:

- `keel-1.90.124-keel.1-linux-amd64.deb` — the final binary
- `sccache-cache.tar.zst` — populated sccache dir from the Keel CI build, ready to be untar'd to `~/.sccache`

Future releases add platform packages (`*.dmg`, `*.msi`) and the matching cache snapshots.
