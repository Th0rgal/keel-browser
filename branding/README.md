# Keel Branding

What we change, what we don't.

## We change

- Product name strings (`IDS_PRODUCT_NAME`, `IDS_SHORT_PRODUCT_NAME`, `IDS_PRODUCT_NAME_LONG`)
- About-page company name and copyright line
- App icon (`branding/icons/keel.svg`, rasterized in `scripts/apply-branding.sh`)
- New-tab branding (see `newtab/`)
- Default window title where Brave hardcodes "Brave"

## We do NOT change

- Profile directory on disk (`BraveSoftware/Brave-Browser`)
- Binary name (`brave`)
- macOS bundle ID (`com.brave.Browser`)
- Internal URL host (`brave://`)
- Channel names (`stable` / `beta` / `dev` / `nightly`)
- User-Agent brand token (kept as `Brave` for compatibility)
- Mojo / IPC interface names
- Component-update IDs

This is deliberate. Renaming these breaks Brave's updater, the Safe Browsing component update channel, profile migration, and most importantly **makes every Brave rebase painful**. Keel's value comes from staying close to upstream, not from internal renaming.

If a user types `brave://settings` they get the settings page. If they type `keel://settings` they get a not-found. That's fine — `chrome://settings` works in both directions and is the cross-Chromium convention anyway.

## Generating raster icons

```
scripts/render-icons.sh
```

Reads `branding/icons/keel.svg` and rasterizes to the sizes Chromium expects (16, 32, 48, 64, 128, 256, 512). Requires `rsvg-convert` or `inkscape` to be installed; the script picks whichever is on PATH.
