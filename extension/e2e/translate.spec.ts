import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { startMockServer } from './helpers/mock-server';
import path from 'node:path';
import {
  seedSettings,
  getTabId,
  translateTab,
  restoreTab,
  stopWatchTab,
  inspectTranslation,
  translateSelectionInTab,
  inspectSelectionOverlay,
  reinjectFrame,
} from './helpers/ext-control';

// Main path: local fixture page + loopback mock OpenAI API.

test.describe('translate main path', () => {
  test('bilingual → restore leaves original DOM', async ({ extContext, extensionId, sw }) => {
    const mock = await startMockServer();
    try {
      await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });

      const page = await extContext.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await expect(page.locator('#title')).toHaveText('Hello World');

      const tabId = await getTabId(page, sw);
      const result = await translateTab(sw, tabId, 'bilingual');
      expect(result.success, JSON.stringify(result)).toBeTruthy();
      expect(Number(result.count) || 0).toBeGreaterThan(0);

      await expect
        .poll(async () => (await inspectTranslation(page)).targetCount, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const after = await inspectTranslation(page);
      expect(after.doneCount).toBeGreaterThan(0);
      expect(after.targetSamples.some((t) => t.includes('译:'))).toBeTruthy();
      expect(after.editorText).toBe('Do not translate this editable text.');

      await restoreTab(sw, tabId);
      await expect
        .poll(async () => (await inspectTranslation(page)).targetCount, { timeout: 10_000 })
        .toBe(0);

      const restored = await inspectTranslation(page);
      expect(restored.doneCount).toBe(0);
      expect(restored.titleText).toBe('Hello World');
      expect(restored.p1Text).toContain('first paragraph');
      expect(restored.editorText).toBe('Do not translate this editable text.');
    } finally {
      await mock.close();
    }
  });

  test('replace mode updates source text in place', async ({ extContext, extensionId, sw }) => {
    const mock = await startMockServer();
    try {
      await seedSettings(extContext, extensionId, {
        apiBase: mock.apiBase,
        mode: 'replace',
      });

      const page = await extContext.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      const tabId = await getTabId(page, sw);
      const result = await translateTab(sw, tabId, 'replace');
      expect(result.success, JSON.stringify(result)).toBeTruthy();

      await expect(page.locator('#title')).toHaveText('译:Hello World', { timeout: 15_000 });

      const after = await inspectTranslation(page);
      expect(after.doneCount).toBeGreaterThan(0);
      expect(after.hideCount + after.replaceCount + after.targetCount).toBe(0);
      expect(after.editorText).toBe('Do not translate this editable text.');
      await stopWatchTab(sw, tabId);
    } finally {
      await mock.close();
    }
  });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test(`replacement retains page interactions at ${viewport.width}px`, async ({ extContext, extensionId, sw }) => {
      const mock = await startMockServer();
      try {
        await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, mode: 'replace' });
        const page = await extContext.newPage();
        await page.setViewportSize(viewport);
        // The article fixture has no favicon; keep browser resource errors out
        // of the interaction/console assertions without filtering app errors.
        await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
        });
        await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveTitle('TapTranslate E2E Article Fixture');
        await expect(page).toHaveURL(mock.fixtureUrl('article.html'));
        await page.locator('main').evaluate((main) => {
          main.innerHTML = `
            <h1>Interactive translation</h1>
            <p id="rich">Read <a id="route" href="#details" class="router-link"><strong id="route-label">the documentation</strong></a> before continuing.</p>
            <nav><a id="action" href="#panel" role="button"><span id="action-label">Open panel</span></a></nav>
            <div><button id="toggle" type="button"><span id="button-label">Toggle panel</span></button></div>
            <p><a id="native-link" href="#details">Jump to details</a></p>
            <section id="panel" hidden>Panel opened successfully.</section>
            <p id="details">More documentation details.</p>`;
          const route = document.querySelector<HTMLAnchorElement>('#route')!;
          const routeLabel = document.querySelector<HTMLElement>('#route-label')!;
          const actionLabel = document.querySelector<HTMLElement>('#action-label')!;
          const button = document.querySelector<HTMLButtonElement>('#toggle')!;
          const buttonLabel = document.querySelector<HTMLElement>('#button-label')!;
          const panel = document.querySelector<HTMLElement>('#panel')!;
          const refs = [route, routeLabel, routeLabel.firstChild, actionLabel, actionLabel.firstChild, button, buttonLabel, buttonLabel.firstChild];
          Object.assign(window, { replacementRefs: refs });
          const bump = (key: string) => { document.body.dataset[key] = String(Number(document.body.dataset[key] ?? 0) + 1); };
          route.addEventListener('click', (event) => { event.preventDefault(); bump('routeClicks'); });
          main.addEventListener('click', (event) => {
            if (event.target === routeLabel) bump('delegatedClicks');
          });
          actionLabel.addEventListener('click', (event) => { event.preventDefault(); panel.hidden = false; bump('actionClicks'); });
          buttonLabel.addEventListener('click', () => bump('labelClicks'));
          button.addEventListener('click', () => { panel.hidden = !panel.hidden; bump('buttonClicks'); });
          route.focus();
        });

        const tabId = await getTabId(page, sw);
        expect((await translateTab(sw, tabId, 'replace')).success).toBeTruthy();
        await expect(page.locator('#route-label')).toHaveText('译:the documentation');
        await expect(page.locator('#action-label')).toHaveText('译:Open panel');
        // Native controls are always protected by the shared content policy.
        await expect(page.locator('#button-label')).toHaveText('Toggle panel');
        await expect(page.locator('#route')).toBeFocused();
        const checkIdentity = () => page.evaluate(() => {
          const ids = ['route', 'route-label', 'action-label', 'toggle', 'button-label'];
          const [route, label, action, button, buttonLabel] = ids.map((id) => document.getElementById(id)!);
          const current = [route, label, label.firstChild, action, action.firstChild, button, buttonLabel, buttonLabel.firstChild];
          const original = (window as typeof window & { replacementRefs: Node[] }).replacementRefs;
          return current.every((node, index) => node === original[index]);
        });
        expect(await checkIdentity()).toBe(true);
        await page.locator('#route-label').click();
        await expect(page.locator('body')).toHaveAttribute('data-route-clicks', '1');
        await expect(page.locator('body')).toHaveAttribute('data-delegated-clicks', '1');
        await page.locator('#action-label').click();
        await expect(page.locator('#panel')).toBeVisible();
        await page.locator('#button-label').click();
        await expect(page.locator('#panel')).toBeHidden();
        await expect(page.locator('body')).toHaveAttribute('data-label-clicks', '1');
        await expect(page.locator('body')).toHaveAttribute('data-button-clicks', '1');
        await page.locator('#native-link').click();
        await expect(page).toHaveURL(`${mock.fixtureUrl('article.html')}#details`);

        // A framework can continue updating its original Text reference.
        await page.locator('#route-label').evaluate((label) => { label.firstChild!.nodeValue = 'Updated documentation'; });
        await expect(page.locator('#route-label')).toHaveText('译:Updated documentation', { timeout: 15_000 });
        expect(await checkIdentity()).toBe(true);
        const settledRequests = mock.getRequestCount();
        await page.waitForTimeout(1_000); // Detect observer feedback/retranslation loops.
        expect(mock.getRequestCount()).toBe(settledRequests);
        if (process.env.TAP_TRANSLATE_QA_DIR) {
          await page.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, `replace-${viewport.width}.png`), fullPage: true });
        }
        await reinjectFrame(sw, tabId);
        await restoreTab(sw, tabId);
        await expect(page.locator('#route-label')).toHaveText('Updated documentation');
        await expect(page.locator('#button-label')).toHaveText('Toggle panel');
        expect(await checkIdentity()).toBe(true);
        await page.locator('#button-label').click();
        await expect(page.locator('#panel')).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-button-clicks', '2');
        expect(errors).toEqual([]);
      } finally {
        await mock.close();
      }
    });
  }

  test('rich replace restore preserves host language attributes', async ({ extContext, extensionId, sw }) => {
    const mock = await startMockServer();
    try {
      await seedSettings(extContext, extensionId, {
        apiBase: mock.apiBase,
        mode: 'replace',
      });

      const page = await extContext.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      await page.locator('#p1').evaluate((el) => {
        el.innerHTML = 'Read <a href="/docs">the docs</a> before continuing.';
        el.setAttribute('lang', 'en');
        el.setAttribute('dir', 'ltr');
      });

      const tabId = await getTabId(page, sw);
      const result = await translateTab(sw, tabId, 'replace');
      expect(result.success, JSON.stringify(result)).toBeTruthy();
      await expect
        .poll(() => page.locator('#p1').getAttribute('data-tap-translate-mode'), { timeout: 15_000 })
        .toBe('replace');
      await expect(page.locator('#p1')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.locator('#p1')).toHaveAttribute('dir', 'auto');

      await restoreTab(sw, tabId);

      await expect(page.locator('#p1')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#p1')).toHaveAttribute('dir', 'ltr');
      await expect(page.locator('#p1')).not.toHaveAttribute('data-tap-translate-stash-language-attrs', /.+/);
      await expect(page.locator('#p1')).toContainText('Read the docs before continuing.');
    } finally {
      await mock.close();
    }
  });

  test('repeated selection translate reuses one overlay and binding', async ({ extContext, extensionId, sw }) => {
    const mock = await startMockServer();
    try {
      await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });

      const page = await extContext.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      const tabId = await getTabId(page, sw);

      // Mimic context-menu selectionText after the DOM selection is cleared.
      const hostAppearance = await page.evaluate(() => ({ attrs: [...document.documentElement.attributes].map(item => [item.name, item.value]), styles: document.querySelectorAll('style,link[rel="stylesheet"]').length, background: getComputedStyle(document.body).backgroundColor }));
      const result = await translateSelectionInTab(sw, tabId, 'Hello World');
      expect(result.success, JSON.stringify(result)).toBeTruthy();

      await expect
        .poll(async () => (await inspectSelectionOverlay(page)).present, { timeout: 15_000 })
        .toBeTruthy();

      const overlay = await inspectSelectionOverlay(page);
      expect(overlay.originalText).toContain('Hello World');
      expect(overlay.isLoading).toBeFalsy();
      expect(overlay.isError).toBeFalsy();
      expect(overlay.bodyText.length).toBeGreaterThan(0);
      expect(overlay.bodyText).toMatch(/译:|Hello/);

      const second = await translateSelectionInTab(sw, tabId, 'Read the docs');
      expect(second.success, JSON.stringify(second)).toBeTruthy();
      const afterSecond = await inspectSelectionOverlay(page);
      expect(afterSecond.hostCount).toBe(1);
      expect(afterSecond.originalText).toBe('Read the docs');
      expect(afterSecond.isLoading).toBeFalsy();
      expect(afterSecond.isError).toBeFalsy();
      expect(afterSecond.bodyText.length).toBeGreaterThan(0);
      expect(await page.evaluate(() => ({ attrs: [...document.documentElement.attributes].map(item => [item.name, item.value]), styles: document.querySelectorAll('style,link[rel="stylesheet"]').length, background: getComputedStyle(document.body).backgroundColor }))).toEqual(hostAppearance);
      await extContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
      await page.bringToFront();
      const panel = page.locator('#tap-translate-overlay-host .dr-panel');
      await expect(panel.locator('.astryx-button')).toHaveCount(2);
      await panel.locator('.dr-btn').first().click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(afterSecond.bodyText);
      const light = await panel.evaluate(element => getComputedStyle(element).backgroundColor);
      expect(light).not.toBe('rgba(0, 0, 0, 0)');
      if (process.env.TAP_TRANSLATE_QA_DIR) await page.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, 'selection-overlay-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(() => panel.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(light);
      if (process.env.TAP_TRANSLATE_QA_DIR) await page.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, 'selection-overlay-dark.png') });
      await page.keyboard.press('Escape');
      await expect(page.locator('#tap-translate-overlay-host')).toHaveCount(0);
    } finally {
      await mock.close();
    }
  });

  test('disabled-site selection shows an error without flashing loading', async ({
    extContext,
    extensionId,
    sw,
  }) => {
    const mock = await startMockServer();
    try {
      await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });

      const page = await extContext.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __sawTapTranslateLoading?: boolean;
          __tapTranslateLoadingObserver?: MutationObserver;
        };
        state.__sawTapTranslateLoading = false;
        const inspect = () => {
          const hosts = document.querySelectorAll('#tap-translate-overlay-host');
          for (const host of hosts) {
            if (host.shadowRoot?.querySelector('.dr-loading')) {
              state.__sawTapTranslateLoading = true;
            }
          }
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
        state.__tapTranslateLoadingObserver = observer;
      });

      const tabId = await getTabId(page, sw);
      const result = await translateSelectionInTab(sw, tabId, 'Blocked selection', {
        disabled: true,
      });
      expect(result.success).toBeFalsy();
      expect(result.code).toBe('PAGE_UNSUPPORTED');

      const overlay = await inspectSelectionOverlay(page);
      expect(overlay.present).toBeTruthy();
      expect(overlay.isError).toBeTruthy();
      expect(overlay.isLoading).toBeFalsy();
      const sawLoading = await page.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __sawTapTranslateLoading?: boolean;
          __tapTranslateLoadingObserver?: MutationObserver;
        };
        state.__tapTranslateLoadingObserver?.disconnect();
        return Boolean(state.__sawTapTranslateLoading);
      });
      expect(sawLoading).toBeFalsy();
    } finally {
      await mock.close();
    }
  });

  test('selection destroyed mid-flight cannot recreate an orphan overlay', async ({
    extContext,
    extensionId,
    sw,
  }) => {
    const mock = await startMockServer();
    mock.setResponseDelay(1_000);
    try {
      await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });

      const page = await extContext.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      const tabId = await getTabId(page, sw);

      const pending = translateSelectionInTab(sw, tabId, 'Slow selection');
      await expect
        .poll(async () => (await inspectSelectionOverlay(page)).isLoading, { timeout: 10_000 })
        .toBeTruthy();

      await reinjectFrame(sw, tabId);
      const cancelled = await pending;
      expect(cancelled.success).toBeFalsy();
      expect(cancelled.code).toBe('SESSION_CANCELLED');
      await page.waitForTimeout(1_200);

      const afterDestroy = await inspectSelectionOverlay(page);
      expect(afterDestroy.present).toBeFalsy();
      expect(afterDestroy.hostCount).toBe(0);

      // The replacement binding remains usable.
      mock.setResponseDelay(0);
      const next = await translateSelectionInTab(sw, tabId, 'Fresh selection');
      expect(next.success, JSON.stringify(next)).toBeTruthy();
      const afterNext = await inspectSelectionOverlay(page);
      expect(afterNext.hostCount).toBe(1);
      expect(afterNext.originalText).toBe('Fresh selection');
    } finally {
      await mock.close();
    }
  });

  test('API 401 surfaces failures without mutating editable', async ({ extContext, extensionId, sw }) => {
    const mock = await startMockServer();
    mock.setMode('auth_fail');
    try {
      await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });

      const page = await extContext.newPage();
      await page.goto(mock.fixtureUrl('article.html'), { waitUntil: 'domcontentloaded' });
      const tabId = await getTabId(page, sw);
      const result = await translateTab(sw, tabId, 'bilingual');
      expect(String(result.error || ''), JSON.stringify(result)).not.toMatch(/timed out/i);

      // Poll DOM only — avoid status relays that could disturb in-flight retries.
      await expect
        .poll(async () => (await inspectTranslation(page)).errorCount, { timeout: 45_000 })
        .toBeGreaterThan(0);

      const after = await inspectTranslation(page);
      expect(after.editorText).toBe('Do not translate this editable text.');
      expect(after.targetSamples.every((t) => !t.includes('译:'))).toBeTruthy();
      await stopWatchTab(sw, tabId);
    } finally {
      await mock.close();
    }
  });
});
