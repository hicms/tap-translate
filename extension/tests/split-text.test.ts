// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectUnits, mutationIndexDelta } from '../lib/collector';
import { render, restoreDom } from '../lib/renderer';

function splitParagraph(): HTMLParagraphElement {
  const grid = document.createElement('waffl-grid');
  grid.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
  const p = document.createElement('p');
  p.setAttribute('aria-label', 'Proximal is a new data company. We focus on research.');
  // Like the site's client-side splitter, create divs inside p through DOM APIs.
  for (const text of ['Proximal is a new data company. ', 'We focus on research.']) {
    const line = document.createElement('div');
    line.setAttribute('aria-hidden', 'true');
    line.style.opacity = '0.1';
    line.textContent = text;
    p.append(line);
  }
  grid.append(p);
  document.body.append(grid);
  return p;
}

describe('accessible labels on animated split text', () => {
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

  it('collects slotted visible aria-hidden lines as one complete paragraph', () => {
    const p = splitParagraph();
    const units = collectUnits();
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ el: p, text: p.getAttribute('aria-label'), splitText: true, kind: 'block' });
    expect(units[0].nodes).toEqual(Array.from(p.children, line => line.firstChild));
    expect(collectUnits(p.parentElement!.shadowRoot!)).toEqual([]);
  });

  it.each(['bilingual', 'replace'] as const)('renders and restores %s without replacing animation elements', mode => {
    const p = splitParagraph();
    const before = p.outerHTML;
    const lines = Array.from(p.children);
    const texts = lines.map(line => line.firstChild);
    render(collectUnits()[0], 'Proximal 是一家新的数据公司。我们专注于研究。', mode, { targetLang: 'zh-CN' });
    expect(p.textContent).toContain('我们专注于研究。');
    expect(lines.every((line, index) => line.parentElement === p && line.firstChild === texts[index])).toBe(true);
    if (mode === 'replace') expect(p.getAttribute('aria-label')).toBe(p.textContent);
    else expect(p.querySelector('.tap-translate-target')!.parentElement).toBe(p);
    expect(collectUnits()).toEqual([]);
    restoreDom();
    expect(p.outerHTML).toBe(before);
  });

  it.each(['mismatched-label', 'unlabelled', 'display-none', 'zero-opacity', 'assistive', 'opt-out', 'hidden-ancestor'])('keeps %s content excluded', reason => {
    const p = splitParagraph();
    const first = p.firstElementChild as HTMLElement;
    if (reason === 'mismatched-label') p.setAttribute('aria-label', 'A different accessible name');
    if (reason === 'unlabelled') p.removeAttribute('aria-label');
    if (reason === 'display-none') first.style.display = 'none';
    if (reason === 'zero-opacity') first.style.opacity = '0';
    if (reason === 'assistive') first.className = 'sr-only';
    if (reason === 'opt-out') p.setAttribute('translate', 'no');
    if (reason === 'hidden-ancestor') p.parentElement!.setAttribute('aria-hidden', 'true');
    expect(collectUnits()).toEqual([]);
  });

  it('does not include opted-out fragments through the accessible label', () => {
    const p = splitParagraph();
    p.firstElementChild!.setAttribute('translate', 'no');
    const units = collectUnits();
    expect(units.every(unit => !unit.splitText)).toBe(true);
    expect(units.every(unit => !unit.text.includes('Proximal is a new data company.'))).toBe(true);
  });

  it('promotes a line-only style change back to its complete paragraph', () => {
    const p = splitParagraph();
    const first = p.firstElementChild as HTMLElement;
    first.style.opacity = '0';
    expect(collectUnits()).toEqual([]);
    const observer = new MutationObserver(() => {});
    observer.observe(p, { attributes: true, subtree: true });
    first.style.opacity = '1';
    const records = observer.takeRecords();
    observer.disconnect();
    const delta = mutationIndexDelta(records, []);
    expect(delta.added).toHaveLength(1);
    expect(delta.added[0].el).toBe(p);
    expect(delta.added[0].text).toBe(p.getAttribute('aria-label'));
    expect(mutationIndexDelta([], [], [first]).added[0].el).toBe(p);
  });

  it('preserves a newer page-authored accessible label during restore', () => {
    const p = splitParagraph();
    render(collectUnits()[0], '翻译后的段落', 'replace');
    p.setAttribute('aria-label', 'Updated by the page');
    restoreDom();
    expect(p.getAttribute('aria-label')).toBe('Updated by the page');
  });
});
