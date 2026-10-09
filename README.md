# TapTranslate

**English** | [中文](README.zh-CN.md)

TapTranslate is a **webpage translation extension** for Chrome, Edge, and Firefox. Translate pages with bilingual display or replace the original text using DeepSeek, OpenAI, Ollama, or any OpenAI-compatible API.

The extension translates pages through the API you configure and caches translations locally in the browser.

**Privacy:** Page text goes only to the API endpoint you configure. API keys stay on your device.

**License:** [MIT](LICENSE).

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Make Targets](#make-targets-common)

---

## Features

### Browser extension (Chrome / Edge / Firefox, Manifest V3)

- Bilingual overlay or replace mode
- On-demand content-script injection (`activeTab` + `scripting`)
- Viewport-first lazy translation + MutationObserver incremental indexing
- Automatic retry with backoff; click-to-retry on persistent failures
- Local translation cache (memory + `chrome.storage.local` LRU)
- Selection overlay + context menu
- Shortcuts: `Alt+T` translate/restore, `Alt+M` mode toggle
- Per-site rules (auto-translate / blocklist)
- Local-only custom headers with explicit opt-in export; full backups include credentials, rule snapshots, valid cache and setup state after confirmation
- UI locales: English, Simplified Chinese, Traditional Chinese, Russian, Spanish, French · targets: zh-CN, en, ru, es, fr

## Architecture

TypeScript + WXT (Manifest V3), with React 19 + [Astryx](https://github.com/facebook/astryx) UI and no bundled backend.

- **Extension pages** (`entrypoints/popup`, `options`, `onboarding`) use React components and shared Astryx controls/theme in `ui/`, including text/number drafts, dropdowns, checkboxes, radio choices, file selection and dialogs. Browsers without CSS anchor positioning use Astryx bottom sheets for selection. Options keeps editable provider/model/site drafts separate from validated settings and saves only changed fields.
- **Selection overlay** (`lib/overlay`) mounts React + Astryx inside an isolated ShadowRoot. All fonts, scripts and styles ship locally; extension themes do not modify host-page styles.
- **Content script** (`entrypoints/tap-translate.ts`) runs a session per frame: `collector` + `sites` identify text, `scheduler` manages viewport queues and retries, and `renderer` displays translations or restores the page.
- **Background** (`entrypoints/background.ts`) receives uncached batches through `runtime.Port`, limits concurrency across tabs, and calls the configured API through `provider`.

Translation flow: collect → viewport queue → memory/local cache → background API request → render. See [site adapters](docs/SITE-ADAPTERS.md) for DOM rules and extension points.

Inline translations remain owned by the page renderer. The content script is injected on demand; background processing does not load React. Astryx uses its prebuilt CSS and neutral theme, so no StyleX compilation step is needed.

The build converts the neutral theme's CSS scopes to theme selectors for Firefox 140 compatibility (`tools/astryx-theme.ts`); it assumes one theme per extension page or overlay.

## Quick start

### Connect an API

1. Get an OpenAI-compatible endpoint + API key.
2. Load the extension (below).
3. In Options set API base, key, and model (e.g. `https://api.deepseek.com`).

### Load the extension

```bash
cd extension
npm ci
npm run build              # load ../artifacts/extension/chrome-mv3
# npm run dev             # development with HMR
```

Chrome/Edge: `chrome://extensions` → Load unpacked → `artifacts/extension/chrome-mv3`.

Firefox: `npm run build:firefox` → load `artifacts/extension/firefox-mv3` (min Firefox **140**).

Builds and ZIPs live in `artifacts/extension/`; test results, reports and configurable caches also stay under `artifacts/`. Paths are defined in [artifact-paths.mjs](extension/tools/artifact-paths.mjs); `make clean` (or `cd extension && npm run clean`) removes this directory. npm's `extension/node_modules/` and WXT's fixed `extension/.wxt/` remain in their default locations.

Copy `extension/dev-settings.json.example` to `extension/dev-settings.json` for local imports or live probes—**never** put secrets under `extension/public/` (that directory is packaged).

### Build and release

From the repository root, run `.\scripts\build.ps1` to type-check, lint, test, and package Chrome and Firefox archives under `artifacts/extension/`. A Chrome build is also synced to `dist/` for **Load unpacked** debugging. Use `-SkipQuality` for a local package-only build, or `-ChromeOnly` / `-FirefoxOnly` for one browser.

After committing source changes to `main`, run `gh auth login` once and then `.\scripts\release.ps1 -Publish`. The script increments the patch version, commits `extension/package.json` and `extension/package-lock.json`, creates an annotated `vX.Y.Z` tag, and atomically pushes `main` plus the tag. Use `-Version 0.2.0` for an explicit version and `-NoWait` to return before GitHub Actions finishes. The tag workflow runs the quality checks, creates Chrome/Firefox ZIPs with SHA-256 files, and publishes the GitHub Release.

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [README.zh-CN.md](README.zh-CN.md) | Full Chinese guide |
| [docs/PERF_LAB.md](docs/PERF_LAB.md) | Performance budget lab |
| [docs/FIREFOX_E2E.md](docs/FIREFOX_E2E.md) | Firefox E2E (Gecko harness notes) |

---

## Make targets (common)

```bash
make test                 # extension type-check, lint, and unit tests
make test-e2e             # Playwright (build + Chromium/Firefox)
make test-e2e-perf        # perf budget lab (Chromium)
make check-npm-audit      # runtime npm audit gate
```


### Full backup and restore

In **Settings → Data**, save or discard pending edits, then choose **Export full backup**. After confirmation, the unencrypted JSON includes all providers and models, parameters and prompts, API keys (including session-only keys), HTTP headers, language/mode preferences, site preferences, custom content rules, built-in rule snapshots, valid persistent translation cache, setup state and host permission inventory. Keep this file private. The regular export continues to omit keys and headers unless explicitly selected.

Use **Import settings** to preview and restore either format. A full backup replaces settings, rules, cache and setup state; legacy settings files still update only supplied fields. Stop translation and close other settings tabs first; refresh webpages afterward. Session keys retain their persistence preference (browsers without session storage keep the existing local-storage fallback). Files are validated before writing. Failed writes trigger compensation; failed compensation is reported alongside the original error. Browser storage areas do not offer an atomic transaction: avoid concurrent edits/translations and keep the extension open during restore.

Built-in snapshots are stored separately from the 200 custom-host budget. The editor, page checks and translation use the restored snapshot, with field-level custom overrides. Hosts absent from the snapshot use generic collection. Import `{"builtinSiteProfiles":null}` to resume the installed version’s built-in rules; omitting that field preserves the snapshot.

Cache entries retain their original seven-day expiry and the existing 5000-entry / 4 MiB translation budget. Expired entries are not revived; reuse still depends on compatible model/parameter/prompt-version fingerprints. Private-window memory cache is excluded and persistent cache cannot be restored in a private window. Files are limited to 20 MiB; unsupported full-backup versions are rejected before writing.

Host access is requested again through the browser. Denial prevents data import. Existing grants are retained, and newly granted permissions are not revoked by data rollback. Browser-managed API permissions are recorded only. Browser shortcuts, private-window access switches, live webpage DOM, running translation tasks and remote proxy-server data cannot be restored automatically.
