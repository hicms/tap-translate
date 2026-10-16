// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderBatch, restoreDom, restoreUnit } from '../lib/renderer';
import { collectUnits, extractRichSlots, mutationHasNewContent, mutationIndexDelta } from '../lib/collector';
import type { TranslationPayload, TranslationUnit } from '../lib/types';

function richUnit(el: HTMLElement): TranslationUnit {
  const slots = extractRichSlots(el);
  return { el, text: slots.join(' '), kind: 'block', rich: { slots } };
}

describe('replacement preserves live page nodes', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 40,
      width: 400, height: 40, toJSON() {},
    });
  });
  afterEach(() => {
    restoreDom();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each([
    undefined, null, '', ' \t\n\u00a0', '\u200b\u200e\u2060', [],
    [''], [null], ['阅读', '', '现在。'], ['阅读', undefined, '现在。'],
    Array(3),
  ].map(result => ({ result })))('preserves source DOM for an invalid result: $result', ({ result }) => {
    for (const mode of ['replace', 'bilingual'] as const) {
      for (const rich of [false, true]) {
        document.body.innerHTML = '<p lang="en" dir="ltr">Read <a href="#docs">the docs</a> now.</p>';
        const p = document.querySelector('p')!;
        const link = p.querySelector('a');
        const before = p.outerHTML;
        const unit = rich ? richUnit(p) : { el: p, text: p.textContent!, kind: 'block' as const };
        const payload = result as TranslationPayload;
        expect(() => render(unit, payload, mode)).not.toThrow();
        expect(p.outerHTML).toBe(before);
        renderBatch([{ unit, payload }], mode);
        expect(p.outerHTML).toBe(before);
        expect(p.querySelector('a')).toBe(link);
      }
    }
  });

  it.each([false, true])('keeps unchanged results in place (rich: %s)', rich => {
    document.body.innerHTML = '<p lang="en" dir="ltr">Read <a href="#docs">the docs</a> now.</p>';
    const p = document.querySelector('p')!;
    const before = p.innerHTML;
    const link = p.querySelector('a');
    const unit = rich ? richUnit(p) : { el: p, text: p.textContent!, kind: 'block' as const };
    render(unit, rich ? richUnit(p).rich!.slots : unit.text, 'replace', { targetLang: 'zh-CN' });
    expect(p.innerHTML).toBe(before);
    expect(p.querySelector('a')).toBe(link);
    expect(p.lang).toBe('en');
    expect(p.dir).toBe('ltr');
    restoreDom();
    expect(p.innerHTML).toBe(before);
  });

  it('keeps the original rich link, focus, event target, attributes and text nodes', () => {
    document.body.innerHTML = '<p>Read <a id="docs" class="router-link" href="/docs" aria-label="Documentation"><strong>the docs</strong></a> now.</p>';
    const p = document.querySelector('p')!;
    const link = p.querySelector('a')!;
    const label = link.querySelector('strong')!;
    const text = label.firstChild;
    const before = p.innerHTML;
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', click);
    link.focus();

    render(richUnit(p), ['阅读', '文档', '现在。'], 'replace', { targetLang: 'zh-CN' });

    expect(p.querySelectorAll('a')).toHaveLength(1);
    expect(p.querySelector('a')).toBe(link);
    expect(link.querySelector('strong')).toBe(label);
    expect(label.firstChild).toBe(text);
    expect(label.textContent).toBe('文档');
    expect(link.parentElement).toBe(p);
    expect(document.activeElement).toBe(link);
    expect(link.className).toBe('router-link');
    expect(link.getAttribute('aria-label')).toBe('Documentation');
    label.click();
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.calls[0][0].target).toBe(label);
    expect(p.querySelector('.tap-translate-original-hidden')).toBeNull();

    restoreDom();
    expect(p.innerHTML).toBe(before);
    expect(label.firstChild).toBe(text);
    label.click();
    expect(click).toHaveBeenCalledTimes(2);
  });

  it.each(['nav', 'inner', 'block'] as const)('keeps nested control labels in place for %s units', (kind) => {
    document.body.innerHTML = '<a href="#docs" role="button"><span>Open docs</span><svg aria-hidden="true"></svg></a>';
    const link = document.querySelector('a')!;
    const label = link.querySelector('span')!;
    const text = label.firstChild;
    const click = vi.fn((event: Event) => event.preventDefault());
    label.addEventListener('click', click);
    render({ el: link, text: 'Open docs', kind }, '打开文档', 'replace');
    expect(label.parentElement).toBe(link);
    expect(label.firstChild).toBe(text);
    expect(label.textContent).toBe('打开文档');
    expect(link.children).toHaveLength(2);
    label.click();
    expect(click).toHaveBeenCalledOnce();
    restoreDom();
    expect(label.textContent).toBe('Open docs');
    expect(label.firstChild).toBe(text);
  });

  it('keeps a button and surrounding text references through repeated replace/restore', () => {
    document.body.innerHTML = '<p>Save <button type="button">OK</button> and close it now.</p>';
    const p = document.querySelector('p')!;
    const before = Array.from(p.childNodes);
    const button = p.querySelector('button')!;
    const click = vi.fn();
    button.addEventListener('click', click);
    const unit: TranslationUnit = {
      el: p, text: 'Save and close it now.', kind: 'inner', segment: true,
      nodes: [before[0] as Text, before[2] as Text],
    };
    for (let i = 0; i < 2; i++) {
      render(unit, '保存并关闭。', 'replace');
      expect(Array.from(p.childNodes)).toEqual(before);
      button.click();
      restoreDom();
      expect(Array.from(p.childNodes)).toEqual(before);
      expect(p.textContent).toBe('Save OK and close it now.');
    }
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite application updates or resurrect removed children on restore', () => {
    document.body.innerHTML = '<p>Read <a href="#docs">the docs</a> now.</p>';
    const p = document.querySelector('p')!;
    const link = p.querySelector('a')!;
    render(richUnit(p), ['阅读', '文档', '现在。'], 'replace');
    link.firstChild!.nodeValue = 'New label from the app';
    p.lastChild!.remove();
    restoreDom();
    expect(link.textContent).toBe('New label from the app');
    expect(p.textContent).toBe('Read New label from the app');
    expect(p.querySelector('a')).toBe(link);
  });

  it('ignores its own text writes while still invalidating external edits', () => {
    document.body.innerHTML = '<p>Read <a href="#docs">the docs</a> now.</p>';
    const p = document.querySelector('p')!;
    const observer = new MutationObserver(() => undefined);
    observer.observe(p, { subtree: true, childList: true, characterData: true });
    try {
      render(richUnit(p), ['阅读', '文档', '现在。'], 'replace');
      const own = observer.takeRecords();
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((record) => record.type === 'characterData')).toBe(true);
      expect(mutationHasNewContent(own)).toBe(false);
      expect(mutationIndexDelta(own, [p]).invalidated).toEqual([]);

      p.querySelector('a')!.firstChild!.nodeValue = 'Updated docs';
      const app = observer.takeRecords();
      expect(mutationHasNewContent(app)).toBe(true);
      expect(mutationIndexDelta([...own, ...app], [p]).invalidated).toEqual([p]);
      restoreUnit(p);
      expect(p.textContent).toBe('Read Updated docs now.');
      expect(mutationHasNewContent(observer.takeRecords())).toBe(false);
    } finally {
      observer.disconnect();
    }
  });

  it('keeps rich source functional if returned slots no longer match the DOM', () => {
    document.body.innerHTML = '<p>Read <a href="#docs">the docs</a> now.</p>';
    const p = document.querySelector('p')!;
    const link = p.querySelector('a')!;
    const before = p.innerHTML;
    render(richUnit(p), ['不完整'], 'replace');
    expect(p.innerHTML).toBe(before);
    expect(p.querySelector('a')).toBe(link);
  });

  it.each(['flex', 'inline-flex', 'grid', 'inline-grid'])('keeps separate tag labels populated inside a %s container', display => {
    // Deaimer research cards: both badges are plain spans, without rich markup.
    document.body.innerHTML = `<main><div class="rs-tags" style="display:${display};gap:6px"><span class="rs-tag-topic" style="background:#ffedd5">Model Evaluation</span><span class="rs-tag-type" style="background:#f1f5f9">Paper</span></div></main>`;
    const host = document.querySelector<HTMLElement>('.rs-tags')!;
    const topic = host.children[0];
    const type = host.children[1];
    const before = host.outerHTML;
    const units = collectUnits();
    expect(units).toHaveLength(1);
    const unit = units[0];
    render(unit, unit.rich ? ['模型评估', '论文'] : '模型评估 论文', 'replace');
    expect(topic.textContent).toBe('模型评估');
    expect(type.textContent).toBe('论文');
    expect(host.children[0]).toBe(topic);
    expect(host.children[1]).toBe(type);
    restoreDom();
    expect(host.outerHTML).toBe(before);
  });
});
