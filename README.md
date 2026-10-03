# TapTranslate

**English** | [中文](README.zh-CN.md)

TapTranslate is a **webpage translation extension** for Chrome, Edge, and Firefox. Translate pages with bilingual display or replace the original text using DeepSeek, OpenAI, Ollama, or any OpenAI-compatible API.

The extension translates pages through the API you configure and caches translations locally in the browser.

**Privacy:** Page text goes only to the API endpoint you configure. API keys stay on your device.

## Table of Contents

- [Features](#features)
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

## Quick start

### Connect an API

1. Get an OpenAI-compatible endpoint + API key.
2. Load the extension (below).
3. In Options set API base, key, and model (e.g. `https://api.deepseek.com`).

### Load the extension

```bash
cd extension
npm ci
npm run build              # load output/chrome-mv3
# npm run dev             # development with HMR
```

Chrome/Edge: `chrome://extensions` → Load unpacked → `extension/output/chrome-mv3`.  
Firefox: `npm run build:firefox` → load `extension/output/firefox-mv3` (min Firefox **140**).

Copy `extension/dev-settings.json.example` for local imports if you like—**never** put secrets under `extension/public/` (that directory is packaged).

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

