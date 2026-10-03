import path from 'node:path';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { startMockServer } from './helpers/mock-server';
import { getTabId, restoreTab, seedSettings, stopWatchTab, translateTab } from './helpers/ext-control';

for (const mode of ['bilingual', 'replace'] as const) {
  for (const width of [1280, 390]) {
    test(`paragraph loading preserves ${mode} content at ${width}px`, async ({ extContext, extensionId, sw }) => {
      const mock = await startMockServer();
      mock.setResponseDelay(2_000);
      try {
        await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, mode });
        const page = await extContext.newPage();
        await page.setViewportSize({ width, height: 844 });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
          if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
        });
        await page.goto(mock.fixtureUrl('article.html'));
        await expect(page).toHaveTitle('TapTranslate E2E Article Fixture');
        await expect(page).toHaveURL(mock.fixtureUrl('article.html'));
        await page.locator('main').evaluate(main => {
          main.innerHTML = `
            <h1>Read at your own pace</h1>
            <p id="first">Translation begins with the content you can see.</p>
            <p id="rich">Read <a id="guide" href="#details"><strong id="guide-label">the documentation</strong></a> before continuing.</p>
            <nav style="display:flex;gap:16px"><a href="#details" id="nav-link"><span>Documentation</span></a></nav>
            <div style="display:grid;grid-template-columns:1fr"><h2 id="grid-title">Keep reading while translation is prepared.</h2></div>
            <div id="component"></div>
            <p id="details">New paragraphs are translated as you scroll.</p>`;
          const link = document.querySelector<HTMLAnchorElement>('#guide')!;
          const label = document.querySelector('#guide-label')!;
          Object.assign(window, { loadingSourceRefs: [link, label, label.firstChild] });
          link.addEventListener('click', event => {
            event.preventDefault();
            document.body.dataset.guideClicks = String(Number(document.body.dataset.guideClicks ?? 0) + 1);
          });
          link.focus();
          const shadow = document.querySelector('#component')!.attachShadow({ mode: 'open' });
          shadow.innerHTML = '<p id="shadow-text">Text inside a web component also has loading feedback.</p>';
        });
        const tabId = await getTabId(page, sw);
        const translating = translateTab(sw, tabId, mode);
        const spinner = page.locator('#first .tap-translate-loading');
        await expect(spinner).toBeVisible();
        await expect(spinner).toHaveAttribute('data-phase', 'translating');
        await expect(spinner).toHaveAttribute('aria-label', 'Translating...');
        await expect(page.locator('#first')).toHaveText('Translation begins with the content you can see.');
        await expect(page.locator('#guide')).toBeFocused();
        await page.locator('#guide-label').click();
        await expect(page.locator('body')).toHaveAttribute('data-guide-clicks', '1');
        expect(await page.evaluate(() => {
          const refs = (window as unknown as { loadingSourceRefs: Node[] }).loadingSourceRefs;
          return refs[0] === document.querySelector('#guide') && refs[1] === document.querySelector('#guide-label') && refs[2] === document.querySelector('#guide-label')!.firstChild;
        })).toBe(true);
        await expect(page.locator('#shadow-text .tap-translate-loading')).toBeVisible();
        expect(await spinner.evaluate(node => ({
          animation: getComputedStyle(node, '::before').animationName,
          width: getComputedStyle(node, '::before').width,
        }))).toEqual({ animation: 'tap-translate-loading-spin', width: '14px' });
        expect(await page.locator('#shadow-text .tap-translate-loading').evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('tap-translate-loading-spin');
        if (process.env.TAP_TRANSLATE_QA_DIR) {
          await page.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, `loading-${mode}-${width}.png`), fullPage: true });
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await spinner.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        expect((await translating).success).toBeTruthy();
        await expect(page.locator('.tap-translate-loading')).toHaveCount(0);
        await expect(page.locator('#first')).toContainText('译:Translation begins');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        if (process.env.TAP_TRANSLATE_QA_DIR) {
          await page.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, `complete-${mode}-${width}.png`), fullPage: true });
        }
        await restoreTab(sw, tabId);
        await expect(page.locator('#first')).toHaveText('Translation begins with the content you can see.');
        const requestCount = mock.getRequestCount();
        await page.evaluate(() => {
          document.body.dataset.loadingFlashes = '0';
          const observer = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
              if (node instanceof Element && node.matches('.tap-translate-loading')) {
                document.body.dataset.loadingFlashes = String(Number(document.body.dataset.loadingFlashes) + 1);
              }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
        await translateTab(sw, tabId, mode);
        await expect(page.locator('body')).toHaveAttribute('data-loading-flashes', '0');
        expect(mock.getRequestCount()).toBe(requestCount);
      } finally {
        await mock.close();
      }
    });
  }
}

test('stopping translation clears visible indicators before the response arrives', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  mock.setResponseDelay(2_000);
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });
    const page = await extContext.newPage();
    await page.goto(mock.fixtureUrl('article.html'));
    const tabId = await getTabId(page, sw);
    const work = translateTab(sw, tabId, 'bilingual');
    await expect(page.locator('.tap-translate-loading').first()).toBeVisible();
    await stopWatchTab(sw, tabId);
    await expect(page.locator('.tap-translate-loading')).toHaveCount(0);
    await expect(page.locator('.tap-translate-loading-style')).toHaveCount(0);
    await work;
    await expect(page.locator('.tap-translate-target')).toHaveCount(0);
  } finally {
    await mock.close();
  }
});

test('loading animation remains visible on pages with a strict style policy', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  mock.setResponseDelay(1_500);
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });
    const page = await extContext.newPage();
    await page.route(mock.fixtureUrl('article.html'), route => route.fulfill({
      status: 200, contentType: 'text/html',
      headers: { 'Content-Security-Policy': "default-src 'self'; style-src 'self'" },
      body: '<!doctype html><title>Strict policy</title><main><p id="first">Translation under a strict style policy.</p></main>',
    }));
    await page.goto(mock.fixtureUrl('article.html'));
    const work = translateTab(sw, await getTabId(page, sw), 'bilingual');
    const spinner = page.locator('#first .tap-translate-loading');
    await expect(spinner).toBeVisible();
    expect(await spinner.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('tap-translate-loading-spin');
    await work;
  } finally {
    await mock.close();
  }
});
