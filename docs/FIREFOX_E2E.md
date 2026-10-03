# Firefox E2E notes

## Why two layers

| Layer | What | Tooling |
|-------|------|---------|
| Temporary addon smoke | Manifest + gecko.id load, browse without crash | `playwright-webextext` |
| Translate main path | collector / session / renderer / restore on Gecko | Content harness (`e2e/helpers/firefox-gecko.ts`) |
| Astryx theme compatibility | Production CSS + real Button markup with `@scope` disabled, light/dark colors | `e2e/astryx-firefox.spec.ts` |

Playwright does **not** expose Firefox MV3 service workers or reliable `moz-extension://` navigation (unlike Chromium `--load-extension`). The harness therefore:

1. Opens the same loopback fixture pages as Chromium (`mock-server`).
2. Injects a minimal `chrome.*` shim + Forced `IntersectionObserver` (headless Gecko often skips IO for already-visible nodes).
3. `eval`s the **built** `artifacts/extension/firefox-mv3/tap-translate.js` + CSS (relative to the repository root; the artifact users ship).
4. Drives `__TAP_TRANSLATE__.handleMessage({ action: 'translatePage', config })`.

The shim responds to `getFrameSessionConfig` with the current session and the fixture's hostname, matching the production content entrypoint handshake. The temporary-addon smoke uses a persistent window so the automatic onboarding tab cannot race creation of a new browser window. It skips `playwright-webextext` 0.0.5's broken permission pre-grant helper for manifests without static content scripts; the production manifest is installed unchanged and no extra permissions are granted.

This matches the approach in `tools/live-translate-probe/run.mjs` (Firefox gecko-shim mode).

## Commands

```bash
cd extension
npm run build:firefox
npx playwright test --project=firefox-ext
```

## Coverage vs Chromium

- **Covered on Firefox:** bilingual + restore, replace, auth-failure error chrome, editable left alone.
- **Chromium-only:** popup/options UI, real SW `scripting.executeScript` relay, DOM lab / perf lab projects.
