import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { artifactPath } from '../../tools/artifact-paths.mjs';

/** Run the unmodified production UI in Gecko. Playwright cannot reliably attach
 * to moz-extension pages; the transport shim replaces only browser APIs. */
export async function installFirefoxUi(page: Page): Promise<void> {
  const root = artifactPath('extension', 'firefox-mv3');
  await page.route('https://tap-ui.test/**', async (route) => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
    const filename = path.resolve(root, relative);
    if (path.relative(root, filename).startsWith('..')) return route.abort();
    const mime: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    await route.fulfill({
      body: readFileSync(filename),
      contentType: mime[path.extname(filename)] ?? 'application/octet-stream',
    });
  });
  await page.addInitScript(() => {
    const area = () => {
      const values: Record<string, unknown> = {};
      return {
        get: async (query?: string | string[] | Record<string, unknown>) => {
          if (!query) return { ...values };
          const keys =
            typeof query === 'string' ? [query] : Array.isArray(query) ? query : Object.keys(query);
          return Object.fromEntries(
            keys
              .filter((key) => key in values || (typeof query === 'object' && !Array.isArray(query)))
              .map((key) => [key, key in values ? values[key] : (query as Record<string, unknown>)[key]]),
          );
        },
        set: async (patch: Record<string, unknown>) => {
          Object.assign(values, patch);
        },
        remove: async (keys: string | string[]) => {
          for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
        },
      };
    };
    const listener = { addListener: () => {}, removeListener: () => {} };
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          id: 'firefox-ui-harness',
          getURL: (value: string) => new URL(value, location.origin).href,
          onMessage: listener,
          sendMessage: async () => undefined,
        },
        storage: { sync: area(), local: area(), session: area(), onChanged: listener },
        i18n: { getUILanguage: () => 'en', getMessage: () => '' },
        permissions: { contains: async () => true, request: async () => true },
        tabs: { query: async () => [] },
      },
    });
  });
}
