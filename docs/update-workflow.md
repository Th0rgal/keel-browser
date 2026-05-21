# Keel Update Workflow

Every Brave Stable release goes through these steps. CI automates as much as possible (`.github/workflows/upstream-watch.yml`, `security-lag.yml`); this doc describes the human path.

## 1. Watch upstream

CI runs `scripts/sync-upstream.sh` every 3 hours and opens a tracker issue when a new Brave Stable tag appears. The issue includes the lag report.

Local equivalent:

```sh
scripts/sync-upstream.sh
scripts/security-lag.sh
```

## 2. Rebase the patch stack

```sh
scripts/clone-upstream.sh                 # checks out upstream/brave-browser at new tag
scripts/apply-patches.sh --check          # dry-run
scripts/apply-patches.sh                  # real apply
```

If a patch conflicts:

1. **Edit the patch**, not the tree. The whole point of the stack is that it's auditable.
2. Re-run `--check` until clean.
3. Commit the patch change with a one-line subject (e.g., `keel: rebase 0004-topbar-layout for Brave 1.91.x`).

Don't squash patches across rebases. Each one stays one concern.

## 3. Build + smoke test

```sh
scripts/build-linux.sh    # or build-macos.sh / build-windows.sh
scripts/smoke-test.sh     # 11 assertions; must all pass
```

If `smoke-test.sh` fails, **don't tag a release.** Fix or revert the offending patch and rebuild.

## 4. Update the build manifest

```sh
jq --arg v "$BRAVE_NEW" --arg t "v$BRAVE_NEW" --arg k "$BRAVE_NEW-keel.1" \
   '.brave_version = $v | .brave_tag = $t | .keel_version = $k | .pinned_at = (now|todate)' \
   build/keel.json > build/keel.json.tmp && mv build/keel.json.tmp build/keel.json
```

Re-run `scripts/security-lag.sh`. Expected output:

```text
Upstream Brave:    <new>
Upstream Chromium: <new>
Keel:              <new>-keel.1
Security lag:      0h
Patch status:      clean
Build status:      passing
```

## 5. Tag + release

```sh
git tag -a v<new>-keel.1 -m "Keel <new>.keel.1 (Brave <new>, Chromium <new>)"
git push origin v<new>-keel.1
```

`ci/workflows/build.yml` picks up the tag, runs the source-build job, and uploads the platform artifacts.

## 6. Close the lag issue

`ci/workflows/security-lag.yml` auto-closes the security-lag issue when the next hourly run sees 0h lag.

## Out-of-cycle (security)

If upstream Brave ships a critical update:

1. `scripts/sync-upstream.sh` fires immediately
2. Skip waiting for the 3-hour cron — run steps 2–5 by hand
3. Target 24h end-to-end. If we slip past 72h, the README banner should advise users to switch to official Brave until catch-up.

The patch stack is six small patches by design. Every additional line of source-level customization makes the SLA harder to hit.
