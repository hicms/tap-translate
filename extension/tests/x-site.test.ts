// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://x.com/"}
import fixture from './fixtures/sites/x.html?raw';
import { socialSiteContract } from './social-site-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectUnits, extractRichSlots } from '../lib/collector';
import { buildSafeRichSkeleton, render, restoreDom } from '../lib/renderer';

socialSiteContract('x', fixture, ["Learning about our universe.","Explore our discoveries today.","Useful explanation."]);

describe('emoji inside preserved tokens', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 24, bottom: 24, top: 0 } as DOMRect);
  });
  afterEach(() => { restoreDom(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it.each(['a href="/reader"', 'span class="notranslate"', 'span translate="no"'])('retains positions and interactions inside %s', wrapper => {
    const tag = wrapper.split(' ')[0];
    document.body.innerHTML = `<main><article data-testid="tweet"><div data-testid="tweetText">Start <${wrapper}><img alt="🚀"></${tag}> here.</div></article></main>`;
    const body = document.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
    const token = body.firstElementChild!;
    const emoji = token.firstElementChild!;
    const original = body.textContent;
    const click = vi.fn((event: Event) => event.preventDefault());
    token.addEventListener('click', click);
    const unit = collectUnits()[0];
    expect(unit.rich?.slots).toEqual(['Start', 'here.']);
    const skeleton = buildSafeRichSkeleton(body);
    expect(extractRichSlots(skeleton)).toEqual(unit.rich?.slots);
    expect(skeleton.textContent).toBe('Start 🚀 here.');
    for (const mode of ['replace', 'bilingual'] as const) {
      render(unit, ['开始', '这里。'], mode);
      expect(body.firstElementChild).toBe(token);
      expect(token.firstElementChild).toBe(emoji);
      if (mode === 'replace') {
        expect(token.previousSibling?.textContent).toBe('开始 ');
        expect(token.nextSibling?.textContent).toBe(' 这里。');
      } else {
        expect(body.querySelector('.tap-translate-target')?.textContent?.replace(/[\u200b\u00a0]/g, '').trim()).toBe('开始 🚀 这里。');
      }
      (token as HTMLElement).click();
      restoreDom();
      expect(body.textContent).toBe(original);
      expect(body.firstElementChild).toBe(token);
      expect(token.firstElementChild).toBe(emoji);
    }
    expect(click).toHaveBeenCalledTimes(2);
    if (tag === 'a') expect(token.getAttribute('href')).toBe('/reader');
  });
});
