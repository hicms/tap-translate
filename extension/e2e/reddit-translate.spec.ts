import fs from 'node:fs';
import { extTest as test, expectExt as expect } from './helpers/ext-fixture';
import { startMockServer } from './helpers/mock-server';
import { getTabId, restoreTab, seedSettings, translateTab } from './helpers/ext-control';

const fixture = fs.readFileSync(new URL('../tests/fixtures/sites/reddit-feed.html', import.meta.url), 'utf8');
test.use({ testHostPermissions: ['https://www.reddit.com/*'] });

test('Reddit feed permalink body translates and restores with the built-in rule', async ({ extContext, extensionId, sw }) => {
  const mock = await startMockServer();
  try {
    await seedSettings(extContext, extensionId, { apiBase: mock.apiBase });
    expect(await sw.evaluate(() => chrome.permissions.contains({ origins: ['https://www.reddit.com/*'] }))).toBe(true);
    const page = await extContext.newPage();
    // Use the actual hostname policy with local synthetic markup, never the live site.
    await page.route('https://www.reddit.com/**', route => route.fulfill({
      contentType: 'text/html', body: `<!doctype html><html><head><title>Reddit feed regression fixture</title><style>body{font:16px/1.5 sans-serif;margin:30px}main{max-width:700px}shreddit-post,shreddit-post-text-body,a[slot="title"],a[slot="text-body"]{display:block}p{margin:12px 0}</style></head><body>${fixture}</body></html>`,
    }));
    await page.goto('https://www.reddit.com/r/example/');
    const original = await page.locator('#feed-body-link').textContent();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => {
      const link = document.getElementById('feed-body-link')!;
      Object.assign(window, { redditBodyLink: link, redditBodyClicks: 0 });
      link.addEventListener('click', event => { event.preventDefault(); (window as unknown as { redditBodyClicks: number }).redditBodyClicks++; });
    });
    const tabId = await getTabId(page, sw);
    for (const mode of ['bilingual', 'replace'] as const) {
      await translateTab(sw, tabId, mode);
      for (const id of ['feed-title', 'feed-intro', 'feed-detail', 'feed-protected', 'feed-comment']) {
        await expect(page.locator(`#${id}`)).toContainText('译:');
      }
      await expect(page.locator('[slot="credit-bar"]')).not.toContainText('译:');
      await expect(page.locator('[promoted]')).not.toContainText('译:');
      await expect(page.locator('#feed-token')).toHaveText('OriginalToken');
      await expect(page.locator('#feed-action')).toHaveText('Expand the post');
      await expect(page.locator('#feed-body-link code')).toHaveText('Unchanged code sample.');
      expect(await page.evaluate(() => document.getElementById('feed-body-link') === (window as unknown as { redditBodyLink: HTMLElement }).redditBodyLink)).toBe(true);
      await restoreTab(sw, tabId);
      await expect(page.locator('#feed-body-link')).toHaveText(original!);
      await expect(page.locator('.tap-translate-target')).toHaveCount(0);
    }
    await page.locator('#feed-intro').click();
    expect(await page.evaluate(() => (window as unknown as { redditBodyClicks: number }).redditBodyClicks)).toBe(1);
    expect(errors).toEqual([]);
  } finally { await mock.close(); }
});
