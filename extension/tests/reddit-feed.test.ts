// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.reddit.com/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/sites/reddit-feed.html?raw';
import { collectUnits, collectUnitsAsync, extractRichSlots, mutationIndexDelta } from '../lib/collector';
import { installContentPolicy } from '../lib/collector/content-policy';
import { buildSafeRichSkeleton, render, restoreDom } from '../lib/renderer';

const expected = [
  'A report from the reading group.',
  'The group discussed a new idea today.',
  'They asked for more information.A follow-up is planned.',
  'Keep in place.',
  'Read for background.',
];

describe('Reddit feed body permalink', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
    installContentPolicy(document);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 24, width: 600, height: 24, toJSON() {},
    });
  });
  afterEach(() => { restoreDom(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('collects the title and all body paragraphs once without community links or chrome', () => {
    expect(collectUnits().map(unit => unit.text).sort()).toEqual([...expected].sort());
  });

  it('uses the same body boundary in cooperative, subtree and incremental collection', async () => {
    const shape = (units: ReturnType<typeof collectUnits>) => units.map(unit => [unit.el.id, unit.text, unit.rich?.slots]);
    expect(shape((await collectUnitsAsync(document.body, { budgetMs: 0 })).units)).toEqual(shape(collectUnits()));
    const body = document.getElementById('feed-body-link')!;
    expect(collectUnits(body).map(unit => unit.text).sort()).toEqual(expected.slice(1, 4).sort());
    const observer = new MutationObserver(() => {});
    observer.observe(body, { childList: true, subtree: true });
    const paragraph = document.createElement('p'); paragraph.textContent = 'A newly loaded body paragraph.';
    body.querySelector('.md')!.append(paragraph);
    expect(mutationIndexDelta(observer.takeRecords(), []).added.map(unit => unit.text)).toEqual(['A newly loaded body paragraph.']);
    observer.disconnect();
  });

  it.each(['bilingual', 'replace'] as const)('renders and restores the body without replacing the permalink or inline nodes (%s)', mode => {
    const body = document.getElementById('feed-body-link') as HTMLAnchorElement;
    const paragraph = document.getElementById('feed-intro')!;
    const emphasis = document.getElementById('feed-emphasis')!;
    const token = document.getElementById('feed-token')!;
    const emoji = document.getElementById('feed-emoji')!;
    const action = document.getElementById('feed-action') as HTMLButtonElement;
    const original = body.textContent;
    const href = body.getAttribute('href');
    const click = vi.fn((event: Event) => event.preventDefault()); body.addEventListener('click', click);
    action.focus();
    const units = collectUnits(body);
    expect(units).toHaveLength(3);
    for (const unit of units) {
      if (unit.rich) expect(extractRichSlots(buildSafeRichSkeleton(unit.el))).toEqual(unit.rich.slots);
      render(unit, unit.rich ? unit.rich.slots.map(slot => `译:${slot}`) : `译:${unit.text}`, mode);
    }
    expect(paragraph.textContent).toContain('译:The group discussed');
    expect(document.getElementById('feed-body-link')).toBe(body);
    expect(document.getElementById('feed-emphasis')).toBe(emphasis);
    expect(document.getElementById('feed-token')).toBe(token);
    expect(document.getElementById('feed-emoji')).toBe(emoji);
    expect(document.activeElement).toBe(action);
    expect(body.getAttribute('href')).toBe(href);
    body.click(); expect(click).toHaveBeenCalledTimes(1);
    restoreDom();
    expect(body.textContent).toBe(original);
    expect(document.getElementById('feed-emphasis')).toBe(emphasis);
    expect(document.querySelector('.tap-translate-target')).toBeNull();
  });
});
