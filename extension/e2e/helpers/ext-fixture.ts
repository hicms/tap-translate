import { test as base, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.resolve(dirname, '../../output/chrome-mv3');

/**
 * Persistent Chromium context with the built MV3 extension loaded.
 * Unique user-data-dir per test; teardown never blocks on extension ports.
 */
export const extTest = base.extend<{
  extContext: BrowserContext;
  extensionId: string;
  sw: Worker;
  testHostPermissions: string[];
}>({
  testHostPermissions: [[], { option: true }],
  extContext: async ({ testHostPermissions }, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-translate-e2e-'));
    let extensionPath = EXTENSION_PATH;
    if (testHostPermissions.length) {
      // Headless Chromium cannot accept the native optional-permission prompt.
      // Add only explicit fixture hosts to a disposable copy of the build.
      extensionPath = path.join(userDataDir, 'test-extension');
      fs.cpSync(EXTENSION_PATH, extensionPath, { recursive: true });
      const manifestPath = path.join(extensionPath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.host_permissions = [...new Set([...manifest.host_permissions, ...testHostPermissions])];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      executablePath: process.env.TAP_TRANSLATE_CHROMIUM_PATH,
      headless: true,
      args: [
        '--headless=new',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    try {
      await use(context);
    } finally {
      await Promise.race([
        context.close().catch(() => undefined),
        new Promise((r) => setTimeout(r, 3_000)),
      ]);
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },
  sw: async ({ extContext }, use) => {
    let [sw] = extContext.serviceWorkers();
    if (!sw) sw = await extContext.waitForEvent('serviceworker', { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 500));
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    const extensionId = sw.url().split('/')[2] ?? '';
    expect(extensionId).not.toEqual('');
    await use(extensionId);
  },
});

export const expectExt = extTest.expect;
