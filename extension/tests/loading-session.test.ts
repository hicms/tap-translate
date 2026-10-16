// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentSession } from '../lib/scheduler/session';
import { translateBatchViaPort } from '../lib/messaging';
import { lookup, store } from '../lib/cache';
import { TapTranslateError } from '../lib/errors';
import { collectSlotTextNodes, collectUnits, mutationHasNewContent } from '../lib/collector';
import { buildSafeRichSkeleton, restoreDom } from '../lib/renderer';
import type { PublicSessionConfig } from '../lib/types';

vi.mock('../lib/messaging', async () => {
  const errors = await vi.importActual<typeof import('../lib/errors')>('../lib/errors');
  return { translateBatchViaPort: vi.fn(), isAbortError: errors.isAbortError };
});
vi.mock('../lib/cache', () => ({ lookup: vi.fn(), store: vi.fn(() => Promise.resolve()) }));
vi.mock('../lib/runtime/yield', () => ({ yieldToMain: () => Promise.resolve() }));
vi.mock('../lib/i18n', () => ({
  catalogLocale: (locale: string) => locale,
  getUiMessage: (key: string, _subs: unknown, locale: string) => `${locale}:${key}`,
}));

const config: PublicSessionConfig = {
  sessionId: 'loading-test', revision: 1, targetLang: 'zh-CN', uiLocale: 'zh-CN',
  mode: 'bilingual', maxConcurrent: 2, batchSize: 1,
  providerFingerprint: 'loading-test', disabled: false,
};
const sessions: ContentSession[] = [];
let requests: Array<{ texts: string[]; resolve: (results: string[]) => void; reject: (error: unknown) => void }>;

class VisibleObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
}

function start(overrides: Partial<PublicSessionConfig> = {}) {
  const session = new ContentSession({ ...config, ...overrides });
  sessions.push(session);
  void session.start();
  return session;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', VisibleObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 40,
    width: 400, height: 40, toJSON() {},
  });
  document.body.innerHTML = '<main><p id="first">Read the article before continuing.</p><p id="second">Another paragraph waits for a separate request.</p></main>';
  requests = [];
  vi.mocked(lookup).mockReset().mockImplementation(async texts => texts.map(() => null));
  vi.mocked(store).mockClear();
  vi.mocked(translateBatchViaPort).mockReset().mockImplementation(texts => new Promise((resolve, reject) => requests.push({ texts, resolve, reject })));
});

afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose('stop');
  await vi.advanceTimersByTimeAsync(10_000);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('paragraph loading feedback', () => {
  it.each([1, 2])('disposes invalid contexts with %i concurrent batches and settles start promptly', async maxConcurrent => {
    const session = new ContentSession({ ...config, maxConcurrent });
    sessions.push(session);
    const settled = vi.fn();
    void session.start().then(settled);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelectorAll('.tap-translate-loading')).toHaveLength(2);
    const signal = vi.mocked(translateBatchViaPort).mock.calls[0][1]?.signal;
    requests[0].reject(new Error('Extension context invalidated.'));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.alive).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(session.status()).toMatchObject({ translating: false, watching: false, failed: 0 });
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'SESSION_CANCELLED' }));
    expect(document.querySelector('.tap-translate-loading')).toBeNull();
    expect(document.querySelector('.tap-translate-loading-style')).toBeNull();
    for (const request of requests) request.resolve(['迟到译文']);
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<p>A new paragraph after invalidation must stay untouched.</p>');
    session.resumeWatch();
    expect(session.retryFailed()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toHaveLength(maxConcurrent);
    expect(document.body.textContent).not.toContain('迟到译文');
    expect(document.querySelector('.tap-translate-error')).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });

  it('cancels scheduled retries when a peer loses its extension context', async () => {
    const session = start();
    await vi.advanceTimersByTimeAsync(200);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requests[0].reject(new TapTranslateError('UPSTREAM_UNAVAILABLE'));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#first .tap-translate-loading')?.getAttribute('data-phase')).toBe('retrying');
    requests[1].reject(new TapTranslateError('UPSTREAM_UNAVAILABLE', { detail: 'Extension context invalidated.' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.alive).toBe(false);
    expect(requests).toHaveLength(2);
    expect(document.querySelector('.tap-translate-loading')).toBeNull();
  });

  it('preserves painted translations when another batch loses its context', async () => {
    const session = start();
    await vi.advanceTimersByTimeAsync(200);
    requests[0].resolve(['已经显示的译文']);
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('#first')?.textContent).toContain('已经显示的译文');
    requests[1].reject(new Error('Extension context invalidated.'));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.alive).toBe(false);
    expect(document.querySelector('#first')?.textContent).toContain('已经显示的译文');
    expect(document.querySelector('.tap-translate-loading')).toBeNull();
  });

  it.each(['bilingual', 'replace'] as const)('shares one description indicator through out-of-order %s paints', async mode => {
    document.body.innerHTML = `<main><h2 id="title">An independent post title.</h2>
      <div slot="text-body"><div id="description" property="schema:articleBody">
        <p id="first">The first part of a continuous description.</p>
        <p id="second">The middle part takes longer to translate.</p>
        <p id="last">The last part finishes before its peers.</p>
      </div></div><p id="outside">A separate paragraph outside this description.</p></main>`;
    start({ mode, maxConcurrent: 6 });
    await vi.advanceTimersByTimeAsync(200);
    const body = document.querySelector('#description')!;
    expect(body.querySelectorAll('.tap-translate-loading')).toHaveLength(1);
    const spinner = body.querySelector('.tap-translate-loading');
    expect(document.querySelector('#last')!.lastChild).toBe(spinner);
    expect(document.querySelector('#title .tap-translate-loading')).not.toBeNull();
    expect(document.querySelector('#outside .tap-translate-loading')).not.toBeNull();
    requests.find(request => request.texts[0].startsWith('The last'))!.resolve(['尾段译文']);
    await vi.advanceTimersByTimeAsync(400);
    expect(body.querySelectorAll('.tap-translate-loading')).toHaveLength(1);
    expect(document.querySelector('#last')!.lastChild).toBe(spinner);
    expect(document.querySelector('#last')!.textContent).toContain('尾段译文');
    requests.find(request => request.texts[0].startsWith('The first'))!.resolve(['首段译文']);
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('#last')!.lastChild).toBe(spinner);
    requests.find(request => request.texts[0].startsWith('The middle'))!.resolve(['中段译文']);
    await vi.advanceTimersByTimeAsync(400);
    expect(body.querySelector('.tap-translate-loading')).toBeNull();
    expect(body.textContent).toContain('中段译文');
  });

  it.each(['bilingual', 'replace'] as const)('keeps %s feedback until the translation is painted', async mode => {
    const source = document.querySelector('#first')!;
    const originalText = source.firstChild;
    start({ mode });
    await vi.advanceTimersByTimeAsync(200);
    expect(requests).toHaveLength(2);
    const indicator = source.querySelector('.tap-translate-loading');
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute('data-phase')).toBe('translating');
    expect(indicator?.getAttribute('aria-label')).toBe('翻译中...');
    expect(source.firstChild).toBe(originalText);
    expect(source.textContent).toBe('Read the article before continuing.');
    requests[0].resolve(['阅读文章后继续。']);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.querySelector('.tap-translate-loading')).toBe(indicator);
    expect(source.textContent).not.toContain('阅读文章');
    await vi.advanceTimersByTimeAsync(400);
    expect(source.querySelector('.tap-translate-loading')).toBeNull();
    expect(source.textContent).toContain('阅读文章后继续。');
    expect(document.querySelector('#second .tap-translate-loading')).not.toBeNull();
  });

  it('does not flash for cache hits even with the batching debounce', async () => {
    vi.mocked(lookup).mockImplementation(async texts => texts.map(() => '缓存译文'));
    const added: Element[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element) added.push(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true });
    start({ batchSize: 6 });
    await vi.advanceTimersByTimeAsync(1_000);
    observer.disconnect();
    expect(translateBatchViaPort).not.toHaveBeenCalled();
    expect(document.querySelector('#first')?.textContent).toContain('缓存译文');
    expect(added.some(node => node.matches('.tap-translate-loading'))).toBe(false);
  });

  it('paints a fully cached unit while its uncached batch peer is still waiting', async () => {
    vi.mocked(lookup).mockImplementation(async texts => texts.map((_, index) => index === 0 ? '缓存译文' : null));
    start({ batchSize: 2 });
    await vi.advanceTimersByTimeAsync(600);
    expect(requests).toHaveLength(1);
    expect(requests[0].texts).toEqual(['Another paragraph waits for a separate request.']);
    expect(document.querySelector('#first')?.textContent).toContain('缓存译文');
    expect(document.querySelector('#first .tap-translate-loading')).toBeNull();
    expect(document.querySelector('#second .tap-translate-loading')).not.toBeNull();
  });

  it('distinguishes queued work from requests and leaves unscheduled units alone', async () => {
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<p id="later">A paragraph outside the scheduled region.</p>');
    vi.stubGlobal('IntersectionObserver', class extends VisibleObserver {
      override observe(target: Element) { if (target.id !== 'later') super.observe(target); }
    });
    start({ maxConcurrent: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('#first .tap-translate-loading')?.getAttribute('data-phase')).toBe('translating');
    expect(document.querySelector('#second .tap-translate-loading')?.getAttribute('data-phase')).toBe('queued');
    expect(document.querySelector('#later .tap-translate-loading')).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('transitions retry feedback to a terminal error and back on manual retry', async () => {
    document.querySelector('#second')!.remove();
    const session = start();
    await vi.advanceTimersByTimeAsync(200);
    requests[0].reject(new TapTranslateError('UPSTREAM_UNAVAILABLE'));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.tap-translate-loading')?.getAttribute('data-phase')).toBe('retrying');
    expect(document.querySelector('.tap-translate-loading')?.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(requests).toHaveLength(2);
    requests[1].reject(new TapTranslateError('AUTH_INVALID'));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.tap-translate-loading')).toBeNull();
    expect(document.querySelector('.tap-translate-error')).not.toBeNull();
    expect(session.retryFailed()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector('.tap-translate-error')).toBeNull();
    expect(document.querySelectorAll('.tap-translate-loading')).toHaveLength(1);
  });

  it.each(['pause', 'restore', 'dispose'] as const)('%s removes pending and visible indicators and ignores late results', async action => {
    const session = start({ maxConcurrent: 1 });
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelectorAll('.tap-translate-loading')).toHaveLength(1);
    if (action === 'dispose') session.dispose('replace');
    else session[action]();
    requests[0].resolve(['不应该显示']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.querySelector('.tap-translate-loading')).toBeNull();
    expect(document.querySelector('.tap-translate-loading-style')).toBeNull();
    expect(document.body.textContent).not.toContain('不应该显示');
  });

  it('resumes pending units after a pause without duplicating feedback', async () => {
    const session = start();
    await vi.advanceTimersByTimeAsync(200);
    session.pause();
    session.resumeWatch();
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelectorAll('.tap-translate-loading')).toHaveLength(2);
    requests[0].resolve(['迟到译文']);
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelectorAll('.tap-translate-loading')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('迟到译文');
  });

  it('does not paint buffered responses after a pause and reschedules them on resume', async () => {
    const session = start();
    await vi.advanceTimersByTimeAsync(200);
    requests[0].resolve(['暂停前的缓冲译文']);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.status().count).toBe(1);
    session.pause();
    requests[1].resolve(['暂停后的迟到译文']);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.status().count).toBe(0);
    expect(document.querySelector('.tap-translate-loading')).toBeNull();
    expect(document.querySelector('#first')?.textContent).toBe('Read the article before continuing.');
    expect(document.querySelector('#second')?.textContent).toBe('Another paragraph waits for a separate request.');
    session.resumeWatch();
    await vi.advanceTimersByTimeAsync(200);
    expect(requests).toHaveLength(4);
    requests[2].resolve(['恢复后的译文']);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('#first')?.textContent).toContain('恢复后的译文');
    expect(document.querySelector('#first .tap-translate-loading')).toBeNull();
    expect(session.status().count).toBe(1);
  });

  it.each(['bilingual', 'replace'] as const)('removes feedback for unchanged results in %s mode and skips already-target text', async mode => {
    const original = document.querySelector('#first')!.firstChild;
    document.querySelector('#second')!.textContent = '这段文字已经是中文，不需要再次翻译。';
    start({ mode });
    await vi.advanceTimersByTimeAsync(200);
    expect(requests).toHaveLength(1);
    requests[0].resolve(requests[0].texts);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.tap-translate-loading')).toBeNull();
    expect(document.querySelector('.tap-translate-target')).toBeNull();
    expect(document.querySelector('#first')!.firstChild).toBe(original);
    expect(original!.textContent).toBe('Read the article before continuing.');
  });

  it.each([[], [''], [' \t\n\u00a0'], ['\u200b\u200e\u2060']].map(results => ({ results })))('keeps source text and retries an empty/missing response: $results', async ({ results }) => {
    document.querySelector('#second')!.remove();
    const source = document.querySelector('#first')!;
    const original = source.firstChild!;
    const session = start({ mode: 'replace' });
    await vi.advanceTimersByTimeAsync(200);
    requests[0].resolve(results);
    await vi.advanceTimersByTimeAsync(500);
    expect(original.textContent).toBe('Read the article before continuing.');
    expect(source.firstChild).toBe(original);
    expect(source.hasAttribute('data-tap-translate-done')).toBe(false);
    expect(session.status().count).toBe(0);
    expect(store).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toHaveLength(2);
    requests[1].resolve(['继续之前先阅读文章。']);
    await vi.advanceTimersByTimeAsync(500);
    expect(source.textContent).toBe('继续之前先阅读文章。');
    expect(session.status().count).toBe(1);
    restoreDom();
    expect(source.firstChild).toBe(original);
    expect(source.textContent).toBe('Read the article before continuing.');
  });

  it('treats a blank cached result as a miss and waits for a valid translation', async () => {
    document.querySelector('#second')!.remove();
    vi.mocked(lookup).mockImplementation(async texts => texts.map(() => ' \u200b '));
    const source = document.querySelector('#first')!;
    start({ mode: 'replace' });
    await vi.advanceTimersByTimeAsync(500);
    expect(requests).toHaveLength(1);
    expect(source.firstChild!.textContent).toBe('Read the article before continuing.');
    requests[0].resolve(['继续之前先阅读文章。']);
    await vi.advanceTimersByTimeAsync(500);
    expect(source.textContent).toBe('继续之前先阅读文章。');
  });

  it('keeps a new source revision loading when an old request completes on the same host', async () => {
    document.querySelector('#second')!.remove();
    const source = document.querySelector('#first')!;
    start();
    await vi.advanceTimersByTimeAsync(200);
    source.firstChild!.nodeValue = 'Updated paragraph with a new source revision.';
    await vi.advanceTimersByTimeAsync(700);
    expect(requests).toHaveLength(2);
    const currentIndicator = source.querySelector('.tap-translate-loading');
    expect(currentIndicator).not.toBeNull();
    requests[0].resolve(['陈旧结果']);
    await vi.advanceTimersByTimeAsync(500);
    expect(source.querySelector('.tap-translate-loading')).toBe(currentIndicator);
    expect(source.textContent).not.toContain('陈旧结果');
    requests[1].resolve(['更新后的译文']);
    await vi.advanceTimersByTimeAsync(500);
    expect(source.querySelector('.tap-translate-loading')).toBeNull();
    expect(source.textContent).toContain('更新后的译文');
  });

  it('cleans disconnected hosts and their style references', async () => {
    const session = start();
    await vi.advanceTimersByTimeAsync(200);
    const first = document.querySelector('#first')!;
    const second = document.querySelector('#second')!;
    first.remove();
    second.remove();
    await vi.advanceTimersByTimeAsync(700);
    expect(first.querySelector('.tap-translate-loading')).toBeNull();
    expect(second.querySelector('.tap-translate-loading')).toBeNull();
    expect(document.querySelector('.tap-translate-loading-style')).toBeNull();
    expect(session.status().total).toBe(0);
  });

  it('anchors feedback to visible source while preserving hidden tails, links and source slots', async () => {
    document.body.innerHTML = '<main><p id="first">Read <a href="#docs" id="link">the documentation</a><code>API</code><span hidden>Hidden instructions</span></p></main>';
    const source = document.querySelector('#first')!;
    const link = document.querySelector<HTMLAnchorElement>('#link')!;
    const text = link.firstChild;
    const clicked = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', clicked);
    link.focus();
    const sourceSlots = collectSlotTextNodes(source).map(node => node.nodeValue);
    const sourceTexts = collectUnits().flatMap(unit => unit.rich?.slots ?? [unit.text]);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(source, { childList: true, subtree: true });
    start();
    await vi.advanceTimersByTimeAsync(200);
    const indicator = source.querySelector('.tap-translate-loading')!;
    expect(indicator.parentElement).toBe(link);
    expect(indicator.textContent).toBe('');
    expect(link.firstChild).toBe(text);
    expect(document.activeElement).toBe(link);
    link.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(collectSlotTextNodes(source).map(node => node.nodeValue)).toEqual(sourceSlots);
    expect(buildSafeRichSkeleton(source as HTMLElement).querySelector('.tap-translate-loading')).toBeNull();
    expect(collectUnits().flatMap(unit => unit.rich?.slots ?? [unit.text])).toEqual(sourceTexts);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutationHasNewContent(mutations)).toBe(false);
    observer.disconnect();
  });

  it('installs and cleans shared indicator styles in an open shadow root', async () => {
    const host = document.createElement('section');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>A paragraph inside a component shadow root.</p><p>Another shadow paragraph.</p>';
    const session = start({ maxConcurrent: 4 });
    await vi.advanceTimersByTimeAsync(200);
    expect(root.querySelectorAll('.tap-translate-loading')).toHaveLength(2);
    expect(root.querySelectorAll('.tap-translate-loading-style')).toHaveLength(1);
    session.restore();
    expect(root.querySelector('.tap-translate-loading')).toBeNull();
    expect(root.querySelector('.tap-translate-loading-style')).toBeNull();
  });

  it('restores orphaned indicators in nested shadow roots without a live session', () => {
    const host = document.createElement('section');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const nestedHost = document.createElement('section');
    shadow.appendChild(nestedHost);
    const nested = nestedHost.attachShadow({ mode: 'open' });
    const roots = [document.body, shadow, nested];
    for (const root of roots) {
      const paragraph = document.createElement('p');
      paragraph.innerHTML = 'Original text.<span class="tap-translate-loading" translate="no"></span>';
      const style = document.createElement('style');
      style.className = 'tap-translate-loading-style';
      root.append(paragraph, style);
    }
    restoreDom();
    for (const root of roots) {
      expect(root.querySelector('.tap-translate-loading, .tap-translate-loading-style')).toBeNull();
      expect(root.textContent).toContain('Original text.');
    }
  });
});
