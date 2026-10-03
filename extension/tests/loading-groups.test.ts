// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingIndicators } from '../lib/renderer/loading';
import { render } from '../lib/renderer';
import type { TranslationUnit } from '../lib/types';

let loading: LoadingIndicators;
const unit = (id: string): TranslationUnit => {
  const el = document.getElementById(id)!;
  return { el, text: el.textContent!, kind: 'block' };
};
const feedback = (root: ParentNode = document) => root.querySelectorAll('.tap-translate-loading');

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 40,
    width: 400, height: 40, toJSON() {},
  });
  document.body.innerHTML = `<main>
    <div id="body" slot="text-body"><p id="first">A first sentence remains pending.</p><p id="last">A final sentence finishes early.</p></div>
    <div id="other" slot="text-body"><p id="separate">An independent description.</p></div>
  </main>`;
  loading = new LoadingIndicators('en');
});
afterEach(() => {
  loading.clearAll();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shared description feedback', () => {
  it('keeps retry/queue states and duplicate updates in one group, independent of other cards', () => {
    const first = unit('first'); const last = unit('last'); const separate = unit('separate');
    loading.update(first, 'translating'); loading.update(last, 'queued'); loading.update(separate, 'translating');
    vi.advanceTimersByTime(200);
    const spinner = document.querySelector('#body .tap-translate-loading')!;
    expect(feedback()).toHaveLength(2);
    loading.update(first, 'retrying');
    expect(spinner.getAttribute('data-phase')).toBe('retrying');
    loading.update(first, 'retrying'); loading.update(last, 'translating');
    expect(spinner.getAttribute('data-phase')).toBe('translating');
    loading.render([last], () => render(last, '尾段译文', 'bilingual'));
    expect(spinner.getAttribute('data-phase')).toBe('retrying');
    expect(last.el.lastChild).toBe(spinner);
    loading.clear(first.el);
    expect(feedback(document.querySelector('#body')!)).toHaveLength(0);
    expect(feedback(document.querySelector('#other')!)).toHaveLength(1);
  });

  it('does not let a fast cached peer cancel an existing network wait', () => {
    const first = unit('first'); const last = unit('last');
    loading.update(first, 'translating'); loading.update(last, 'queued');
    loading.ready(last.el);
    loading.render([last], () => render(last, '缓存尾段', 'replace'));
    vi.advanceTimersByTime(200);
    expect(feedback()).toHaveLength(1);
    expect(last.el.lastChild).toBe(feedback()[0]);
    loading.ready(first.el);
    expect(feedback()).toHaveLength(1);
    loading.render([first], () => render(first, '首段译文', 'replace'));
    expect(feedback()).toHaveLength(0);
    expect(document.querySelector('.tap-translate-loading-style')).toBeNull();
  });

  it('keeps a fully cached group free of inserted markers', async () => {
    const added: Node[] = [];
    const observer = new MutationObserver(records => records.forEach(record => added.push(...record.addedNodes)));
    observer.observe(document.body, { subtree: true, childList: true });
    const units = [unit('first'), unit('last')];
    for (const entry of units) { loading.update(entry, 'queued'); loading.ready(entry.el); }
    loading.render(units, () => units.forEach(entry => render(entry, '缓存译文', 'bilingual')));
    await vi.advanceTimersByTimeAsync(1_000);
    observer.disconnect();
    expect(added.some(node => node instanceof Element && node.matches('.tap-translate-loading'))).toBe(false);
  });

  it.each(['bilingual', 'replace'] as const)('repairs a removed completed tail after %s paint', mode => {
    const first = unit('first'); const last = unit('last');
    loading.update(first, 'translating'); loading.update(last, 'translating');
    vi.advanceTimersByTime(200);
    const spinner = feedback()[0];
    loading.render([last], () => render(last, '尾段译文', mode));
    expect(last.el.lastChild).toBe(spinner);
    last.el.remove();
    loading.clear(last.el);
    expect(first.el.lastChild).toBe(spinner);
    expect(feedback()).toHaveLength(1);
  });

  it('reattaches the same marker after the completed tail changes and is translated again', () => {
    const first = unit('first'); const last = unit('last');
    loading.update(first, 'translating'); loading.update(last, 'translating');
    vi.advanceTimersByTime(200);
    const spinner = feedback()[0];
    loading.render([last], () => render(last, '尾段译文', 'replace'));
    last.el.textContent = 'An updated final sentence.';
    last.el.removeAttribute('data-tap-translate-done');
    const updated = unit('last');
    loading.update(updated, 'translating');
    expect(last.el.lastChild).toBe(spinner);
    loading.render([updated], () => render(updated, '更新的尾段', 'replace'));
    expect(last.el.lastChild).toBe(spinner);
    expect(feedback()).toHaveLength(1);
  });

  it('repairs feedback removed by a completed tail rewrite even when that tail needs no new translation', () => {
    const first = unit('first'); const last = unit('last');
    loading.update(first, 'translating'); loading.update(last, 'translating');
    vi.advanceTimersByTime(200);
    const spinner = feedback()[0];
    loading.render([last], () => render(last, '尾段译文', 'replace'));
    last.el.textContent = '这段已经是目标语言，无需重新加入翻译队列。';
    loading.clear(last.el);
    expect(last.el.lastChild).toBe(spinner);
    expect(feedback()).toHaveLength(1);
    loading.clear(first.el);
    expect(feedback()).toHaveLength(0);
    expect(document.querySelector('.tap-translate-loading-style')).toBeNull();
  });

  it('cleans or restores group feedback even when a paint throws', () => {
    const first = unit('first'); const last = unit('last');
    loading.update(first, 'translating'); loading.update(last, 'translating');
    vi.advanceTimersByTime(200);
    const spinner = feedback()[0];
    expect(() => loading.render([last], () => { throw new Error('paint failed'); })).toThrow('paint failed');
    expect(last.el.lastChild).toBe(spinner);
    loading.clear(first.el);
    expect(feedback()).toHaveLength(0);
    expect(document.querySelector('.tap-translate-loading-style')).toBeNull();
  });

  it('keeps nested headings separate and excludes them from the body tail', () => {
    document.querySelector('#body')!.insertAdjacentHTML('beforeend', '<h3 id="heading">An independent subheading.</h3>');
    const first = unit('first'); const last = unit('last'); const heading = unit('heading');
    loading.update(first, 'translating'); loading.update(last, 'translating'); loading.update(heading, 'translating');
    vi.advanceTimersByTime(200);
    expect(feedback()).toHaveLength(2);
    expect(last.el.lastElementChild?.className).toBe('tap-translate-loading');
    expect(heading.el.lastElementChild?.className).toBe('tap-translate-loading');
  });

  it('groups inline fragments in one paragraph without grouping unrelated plain paragraphs', () => {
    document.body.innerHTML = '<p id="paragraph"><span id="first">A fragmented first part.</span><span id="last">A fragmented final part.</span></p><p id="separate">A separate paragraph.</p>';
    for (const id of ['first', 'last', 'separate']) loading.update(unit(id), 'translating');
    vi.advanceTimersByTime(200);
    expect(feedback(document.querySelector('#paragraph')!)).toHaveLength(1);
    expect(feedback()).toHaveLength(2);
  });

  it('maintains one group marker and shared styles in shadow roots, then cancels all timers', () => {
    const root = document.querySelector('#other')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<div slot="text-body"><p>A shadow introduction.</p><p>A second shadow sentence.</p></div>';
    for (const el of root.querySelectorAll('p')) loading.update({ el, text: el.textContent!, kind: 'block' }, 'translating');
    vi.advanceTimersByTime(200);
    expect(feedback(root)).toHaveLength(1);
    expect(root.querySelectorAll('.tap-translate-loading-style')).toHaveLength(1);
    loading.update(unit('first'), 'queued');
    loading.clearAll();
    vi.advanceTimersByTime(1_000);
    expect(feedback(root)).toHaveLength(0);
    expect(feedback()).toHaveLength(0);
    expect(root.querySelector('.tap-translate-loading-style')).toBeNull();
  });
});
