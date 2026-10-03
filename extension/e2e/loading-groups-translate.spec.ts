import path from 'node:path';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { startMockServer } from './helpers/mock-server';
import { getTabId, restoreTab, seedSettings, translateTab } from './helpers/ext-control';

// Reddit AggregateFeed body metadata, with inline paragraphs as in card previews.
// Keep this local fixture independent of personalized feed content and API keys.
const fixture = `<!doctype html><html lang="en"><head><title>Grouped description loading</title>
  <style>
    body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#17334d}
    main{max-width:740px;margin:auto}shreddit-post{display:block;margin-bottom:32px}
    h2{font-size:19px;line-height:1.4;margin:0 0 6px;color:#102030}
    .preview p{display:inline;margin:0}a{color:inherit}
  </style></head><body><main>
  <shreddit-post>
    <h2 id="title" slot="title">If I was Anthropic I'd offer off peak usage discounts</h2>
    <div slot="text-body"><div id="intro" class="preview" property="schema:articleBody">
      <p id="first">I was thinking about how language model providers could offer discounts outside peak hours. </p>
      <p id="middle">There could be a lower price for background work that can wait. Read <a id="guide" href="#details">the proposal</a> for more context. </p>
      <p id="last">The whole introduction should have one loading indicator while its parts are translated.</p>
    </div></div>
  </shreddit-post>
  <shreddit-post>
    <h2 id="other-title" slot="title">Another independent post</h2>
    <div slot="text-body"><div id="other-intro" class="preview" property="schema:articleBody">
      <p>A different description keeps its own loading state. </p><p>Its paragraphs share a single indicator too.</p>
    </div></div>
  </shreddit-post></main></body></html>`;

for (const mode of ['bilingual', 'replace'] as const) {
  for (const width of [1280, 390]) {
    test(`one indicator per introduction in ${mode} at ${width}px`, async ({ extContext, extensionId, sw }) => {
      const mock = await startMockServer();
      mock.setResponseDelay(2_500);
      try {
        await seedSettings(extContext, extensionId, { apiBase: mock.apiBase, mode });
        const page = await extContext.newPage();
        await page.setViewportSize({ width, height: 844 });
        await page.route(mock.fixtureUrl('article.html'), route => route.fulfill({ contentType: 'text/html', body: fixture }));
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
          if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
        });
        await page.goto(mock.fixtureUrl('article.html'));
        await expect(page).toHaveTitle('Grouped description loading');
        await expect(page).toHaveURL(mock.fixtureUrl('article.html'));
        const original = await page.locator('#intro').textContent();
        await page.locator('#guide').evaluate(link => link.addEventListener('click', event => {
          event.preventDefault(); document.body.dataset.clicked = 'true';
        }));
        const tabId = await getTabId(page, sw);
        const work = translateTab(sw, tabId, mode);
        const spinner = page.locator('#intro .tap-translate-loading');
        await expect(spinner).toBeVisible();
        await expect(spinner).toHaveCount(1);
        await expect(page.locator('#last .tap-translate-loading')).toHaveCount(1);
        await expect(page.locator('#first .tap-translate-loading, #middle .tap-translate-loading')).toHaveCount(0);
        await expect(page.locator('#title .tap-translate-loading')).toHaveCount(1);
        await expect(page.locator('#other-intro .tap-translate-loading')).toHaveCount(1);
        expect(await page.locator('#intro').textContent()).toBe(original);
        await page.locator('#guide').click();
        await expect(page.locator('body')).toHaveAttribute('data-clicked', 'true');
        expect(await spinner.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('tap-translate-loading-spin');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (process.env.TAP_TRANSLATE_QA_DIR) {
          await page.screenshot({ path: path.join(process.env.TAP_TRANSLATE_QA_DIR, `grouped-${mode}-${width}.png`), fullPage: true });
        }
        expect((await work).success).toBe(true);
        await expect(page.locator('.tap-translate-loading')).toHaveCount(0);
        for (const id of ['first', 'middle', 'last']) await expect(page.locator('#' + id)).toContainText('译:');
        expect(errors).toEqual([]);
        await restoreTab(sw, tabId);
        expect(await page.locator('#intro').textContent()).toBe(original);
        await expect(page.locator('.tap-translate-loading-style')).toHaveCount(0);
      } finally {
        await mock.close();
      }
    });
  }
}
