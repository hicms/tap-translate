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
- Local-only custom headers with explicit opt-in export
- UI locales: English, Simplified Chinese, Traditional Chinese, Russian, Spanish, French · targets: zh-CN, en, ru, es, fr

## Architecture

TypeScript + WXT (Manifest V3), with React 19 + [Astryx](https://github.com/facebook/astryx) UI and no bundled backend.

- **Extension pages** (`entrypoints/popup`, `options`, `onboarding`) use React components and shared Astryx controls/theme in `ui/`. Options keeps editable provider/model/site drafts separate from validated settings and saves only changed fields.
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

