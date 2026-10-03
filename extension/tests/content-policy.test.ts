// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { collectUnits, collectUnitsAsync } from '../lib/collector';
import { resolveSiteProfile } from '../lib/sites';
import { render, restoreDom } from '../lib/renderer';

afterEach(() => { restoreDom(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('matches only explicitly supported hostnames', () => {
  expect(resolveSiteProfile('github.com')?.id).toBe('github');
  expect(resolveSiteProfile('GITHUB.COM')?.id).toBe('github');
  for (const hostname of ['docs.github.com', 'github.io', 'github.com.evil.test', 'github.enterprise.test', '']) {
    expect(resolveSiteProfile(hostname)).toBeUndefined();
  }
});

it.each(['x', 'facebook', 'reddit', 'youtube', 'instagram', 'threads'])('resolves %s aliases without suffix or subdomain guessing', site => {
  const domain = site === 'x' ? 'x.com' : `${site}.com`;
  expect(resolveSiteProfile(domain)?.id).toBe(site);
  expect(resolveSiteProfile(`WWW.${domain.toUpperCase()}`)?.id).toBe(site);
  for (const host of [`${domain}.evil.test`, `help.${domain}`, `m.${domain}`]) {
    expect(resolveSiteProfile(host)).toBeUndefined();
  }
});

it('keeps generic collection while respecting nested opt-out and code on other sites', () => {
  document.body.innerHTML = '<main><h2>Normal page heading</h2><p>Hello <span class="notranslate">BrandName</span> world.</p><pre><span>source code</span></pre><div translate="NO"><p>Keep this original</p></div><button><span>Action control</span></button><div contenteditable="plaintext-only"><p>My draft</p></div></main>';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 24, bottom: 24, top: 0 } as DOMRect);
  const units = collectUnits();
  expect(units.map(u => u.text)).toEqual(['Normal page heading', 'Hello world.']);
  const paragraph = units.find(u => u.el.tagName === 'P')!;
  expect(paragraph.rich?.slots).toEqual(['Hello', 'world.']);
  render(paragraph, ['你好', '世界。'], 'replace');
  expect(paragraph.el.textContent).toBe('你好 BrandName 世界。');
  restoreDom();
  expect(paragraph.el.textContent).toBe('Hello BrandName world.');
});

it('yields during cooperative collection and observes cancellation', async () => {
  document.body.innerHTML = '<main><p>First paragraph</p><p>Second paragraph</p></main>';
  const controller = new AbortController();
  const yieldMock = vi.fn(async () => { controller.abort(); });
  vi.stubGlobal('scheduler', { yield: yieldMock });
  await expect(collectUnitsAsync(document.body, { budgetMs: 0, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(yieldMock).toHaveBeenCalledTimes(1);
  await expect(collectUnitsAsync(document.body, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});

it.each(['bilingual', 'replace'] as const)('retains protected text when its label is unwrapped (%s)', (mode) => {
  document.body.innerHTML = '<p>Ask <label class="notranslate">Brand</label> to use <code>x</code>.</p>';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 24, bottom: 24, top: 0 } as DOMRect);
  const unit = collectUnits()[0];
  expect(unit.rich?.slots).toEqual(['Ask', 'to use', '.']);
  render(unit, ['请', '使用', '。'], mode);
  const target = mode === 'replace' ? unit.el : unit.el.querySelector('.tap-translate-target')!;
  expect(target.textContent).toBe('请 Brand 使用 x。');
  if (mode === 'bilingual') expect(target.querySelector('label')).toBeNull();
  restoreDom();
  expect(document.querySelector('p')!.textContent).toBe('Ask Brand to use x.');
});
