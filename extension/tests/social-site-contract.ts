import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectUnits, collectUnitsAsync, extractRichSlots, mutationIndexDelta } from '../lib/collector';
import { buildSafeRichSkeleton, render, restoreDom } from '../lib/renderer';
import { resolveSiteProfile } from '../lib/sites';

/** Shared observable contract; each caller supplies its own public DOM shape. */
export function socialSiteContract(site: string, fixture: string, expected: string[]) {
  const el = (id: string) => document.getElementById(id)!;
  beforeEach(() => {
    document.body.innerHTML = fixture;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 24, width: 600, height: 24, toJSON() {},
    });
  });
  afterEach(() => { restoreDom(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  describe(`${site} reading boundaries`, () => {
    it('selects prose once, excluding authors, chrome, drafts and protected tokens', () => {
      expect(resolveSiteProfile(document.location.hostname)?.id).toBe(site);
      const texts = collectUnits().map(u => u.text);
      expect([...texts].sort()).toEqual([...expected].sort());
      expect(texts.join(' ')).not.toMatch(/Public author|Follow|Like|Reply|Share|Draft|Pinned|Author|Menu|@reader|#space|Show more|Unsubmitted|Navigation/);
    });
    it('applies the same policy in sync, cooperative and subtree collection', async () => {
      const shape = (units: ReturnType<typeof collectUnits>) => units.map(u => [u.el.id, u.text, u.kind, u.rich?.slots]);
      expect(shape((await collectUnitsAsync(document.body, { budgetMs: 0 })).units)).toEqual(shape(collectUnits()));
      expect(collectUnits(el('body')).map(u => u.text)).toEqual(['Explore our discoveries today.']);
      expect(collectUnits(el('action'))).toEqual([]);
    });
    it('falls back to generic collection for unknown layouts', async () => {
      document.body.innerHTML = '<main><h1>Account preferences</h1><p>Choose your settings.</p><button>Save</button></main>';
      // Facebook's explicit heading exclusions still apply during fallback.
      const expected = site === 'facebook' ? ['Choose your settings.'] : ['Account preferences', 'Choose your settings.'];
      expect(collectUnits().map(u => u.text)).toEqual(expected);
      expect((await collectUnitsAsync()).units.map(u => u.text)).toEqual(expected);
    });
    it('excludes controls and hashtags even when embedded inside selected prose', () => {
      el('body').insertAdjacentHTML('beforeend', '<a class="notranslate" href="/hashtag/space">#space</a><div role="button"><span>Show more</span></div><span translate="no">KeepToken</span>');
      const units = collectUnits(el('body'));
      expect(units.map(u => u.text)).toEqual(['Explore our discoveries today.']);
      expect(units[0].rich?.slots).toEqual(['Explore', 'our discoveries', 'today.']);
    });
    it('filters newly appended replies without collecting the adjacent author or actions', () => {
      const observer = new MutationObserver(() => {});
      observer.observe(document.body, { subtree: true, childList: true });
      const section = document.createElement('section');
      section.append((el('additional-comment') as HTMLTemplateElement).content.cloneNode(true));
      document.querySelector('main')!.append(section);
      expect(mutationIndexDelta(observer.takeRecords(), collectUnits(el('body')).map(u => u.el)).added.map(u => u.text)).toEqual(['Additional explanation.']);
      observer.disconnect();
    });
    it.each(['bilingual', 'replace'] as const)('retains original interactions, emoji positions and restoration (%s)', mode => {
      const body = el('body');
      const original = body.textContent;
      const mention = el('docs');
      const href = mention.getAttribute('href');
      const action = el('action');
      const emoji = el('emoji');
      const click = vi.fn((event: Event) => event.preventDefault());
      mention.addEventListener('click', click);
      action.addEventListener('click', click);
      action.focus();
      const units = collectUnits();
      const primary = units.find(u => u.el === body)!;
      expect(primary.rich?.slots).toEqual(['Explore', 'our discoveries', 'today.']);
      expect(extractRichSlots(buildSafeRichSkeleton(body))).toEqual(primary.rich?.slots);
      for (const unit of units) render(unit, unit.rich ? unit.rich.slots.map(t => `译:${t}`) : `译:${unit.text}`, mode);
      const target = mode === 'replace' ? body : body.querySelector('.tap-translate-target')!;
      if (mode === 'replace') {
        expect(body.textContent).toBe('译:Explore @reader 译:our discoveries  译:today.');
        expect(emoji.previousSibling?.textContent).toContain('译:our discoveries');
        expect(emoji.nextSibling?.textContent).toContain('译:today.');
      } else {
        expect(target.textContent?.replace(/[\u200b\u00a0]/g, '').trim()).toBe('译:Explore @reader 译:our discoveries 🚀 译:today.');
        expect(target.querySelector('img,button,[role="button"],input')).toBeNull();
        expect(target.querySelector('[translate="no"]')?.textContent).toBe('@reader');
      }
      expect(el('docs')).toBe(mention);
      expect(el('action')).toBe(action);
      expect(el('emoji')).toBe(emoji);
      expect(document.activeElement).toBe(action);
      mention.click(); action.click();
      expect(click).toHaveBeenCalledTimes(2);
      expect(mention.getAttribute('href')).toBe(href);
      restoreDom();
      expect(body.textContent).toBe(original);
      expect(el('emoji')).toBe(emoji);
      expect(document.querySelector('.tap-translate-target')).toBeNull();
    });
  });
}
