// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ContentSession, configChanged } from '../lib/scheduler/session';
import { translatePage, restoreOriginal, getActiveSession } from '../lib/scheduler';
import { translateBatchViaPort } from '../lib/messaging';
import { TapTranslateError } from '../lib/errors';
import type { PublicSessionConfig } from '../lib/types';

vi.mock('../lib/messaging', async () => {
  const errors = await vi.importActual<typeof import('../lib/errors')>('../lib/errors');
  return {
    translateBatchViaPort: vi.fn(),
    isAbortError: errors.isAbortError,
  };
});

vi.mock('../lib/cache', () => ({
  lookup: vi.fn((texts: string[]) => Promise.resolve(texts.map(() => null))),
  store: vi.fn(() => Promise.resolve()),
}));

// Keep cooperative scheduling synchronous under fake timers: the real
// MessageChannel fallback depends on event-loop pumping that fake timers
// do not drive deterministically.
vi.mock('../lib/runtime/yield', () => ({
  yieldToMain: vi.fn(() => Promise.resolve()),
  sliceExceeded: (startedAt: number, budgetMs: number) => performance.now() - startedAt >= budgetMs,
}));

function config(partial: Partial<PublicSessionConfig> = {}): PublicSessionConfig {
  return {
    sessionId: 'sess-1',
    revision: 1,
    targetLang: 'zh-CN',
    uiLocale: 'en',
    mode: 'bilingual',
    maxConcurrent: 2,
    batchSize: 4,
    providerFingerprint: 'fp-aaa',
    disabled: false,
    ...partial,
  };
}

function stubObservers(): void {
  if (typeof IntersectionObserver === 'undefined') {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
  if (typeof MutationObserver === 'undefined') {
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  }
}

describe('configChanged', () => {
  it('detects revision / fingerprint / mode / lang changes', () => {
    const a = config();
    expect(configChanged(a, config())).toBe(false);
    expect(configChanged(a, config({ revision: 2 }))).toBe(true);
    expect(configChanged(a, config({ providerFingerprint: 'fp-bbb' }))).toBe(true);
    expect(configChanged(a, config({ mode: 'replace' }))).toBe(true);
    expect(configChanged(a, config({ targetLang: 'en' }))).toBe(true);
  });
});

describe('ContentSession lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main><p>Hello world</p></main>';
    stubObservers();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('marks disposed sessions as not alive and stops watching', () => {
    const session = new ContentSession(config());
    session.resumeWatch();
    expect(session.alive).toBe(true);
    expect(session.status().watching).toBe(true);
    session.dispose('stop');
    expect(session.alive).toBe(false);
    expect(session.status().watching).toBe(false);
    expect(session.status().translating).toBe(false);
  });

  it('start on disabled config disposes immediately', async () => {
    const session = new ContentSession(config({ disabled: true }));
    const result = await session.start();
    expect(result.success).toBe(false);
    expect(session.alive).toBe(false);
  });

  it('dispose ignores subsequent resumeWatch', () => {
    const session = new ContentSession(config());
    session.dispose('replace');
    session.resumeWatch();
    expect(session.status().watching).toBe(false);
  });

  it('pause then resumeWatch restores watching', () => {
    const session = new ContentSession(config());
    session.resumeWatch();
    expect(session.status().watching).toBe(true);
    session.pause();
    expect(session.status().watching).toBe(false);
    session.resumeWatch();
    expect(session.alive).toBe(true);
    expect(session.status().watching).toBe(true);
    session.dispose('stop');
  });

  it('exposes session id and revision in status', () => {
    const session = new ContentSession(config({ sessionId: 'abc', revision: 9 }));
    expect(session.status().sessionId).toBe('abc');
    expect(session.status().revision).toBe(9);
  });
});

describe('ContentSession scheduling state machine', () => {
  const realRect = Element.prototype.getBoundingClientRect;

  /** Fires `isIntersecting` synchronously on observe so entries enqueue immediately. */
  class AutoIO {
    private readonly cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element): void {
      this.cb(
        [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  function paragraphs(n: number): void {
    const main = document.createElement('main');
    for (let i = 0; i < n; i++) {
      const p = document.createElement('p');
      p.textContent = `Sentence number ${i}: the quick brown fox jumps over the lazy dog.`;
      main.appendChild(p);
    }
    document.body.appendChild(main);
  }

  function hangingPort(): void {
    vi.mocked(translateBatchViaPort).mockImplementation(
      (_texts, opts) =>
        new Promise<string[]>((_resolve, reject) => {
          opts?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', AutoIO);
    Element.prototype.getBoundingClientRect = function () {
      return {
        x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 40,
        width: 400, height: 40, toJSON() {},
      } as DOMRect;
    };
    vi.mocked(translateBatchViaPort).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Element.prototype.getBoundingClientRect = realRect;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it.each(['bilingual', 'replace'] as const)('translates class-only reveals once in %s mode', async (mode) => {
    vi.useFakeTimers();
    document.body.innerHTML = `<style>.rv { opacity:0 } .rv.in { opacity:1 }</style>
      <main><section class="rv"><h2>Three data programs.</h2><p>Existing hidden paragraph.</p></section></main>`;
    vi.mocked(translateBatchViaPort).mockImplementation(async texts => texts.map(t => `译:${t}`));
    const session = new ContentSession(config({ mode }));
    try {
      expect((await session.start()).total).toBe(0);
      document.querySelector('section')!.classList.add('in');
      await vi.advanceTimersByTimeAsync(1_500);
      expect(document.querySelector('h2')!.textContent).toContain('译:Three data programs.');
      expect(document.querySelector('p')!.textContent).toContain('译:Existing hidden paragraph.');
      const calls = vi.mocked(translateBatchViaPort).mock.calls.length;
      document.querySelector('section')!.dispatchEvent(new Event('transitionend', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(translateBatchViaPort).toHaveBeenCalledTimes(calls);
      expect(session.status()).toMatchObject({ total: 2, count: 2 });
      session.restore();
      expect(document.querySelector('h2')!.textContent).toBe('Three data programs.');
    } finally {
      session.dispose('stop');
    }
  });

  it.each(['transitionend', 'animationend'])('rechecks delayed reveals on %s and removes listeners on pause', async eventName => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><section style="opacity:0"><p>Delayed content.</p></section></main>';
    vi.mocked(translateBatchViaPort).mockResolvedValue(['延迟显示的内容']);
    const section = document.querySelector('section')!;
    const realStyle = window.getComputedStyle;
    let revealed = false;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(el => {
      const style = realStyle(el);
      if (el === section) Object.defineProperty(style, 'opacity', { value: revealed ? '1' : '0' });
      return style;
    });
    const session = new ContentSession(config());
    try {
      await session.start();
      section.classList.add('in');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(translateBatchViaPort).not.toHaveBeenCalled();
      // CSS animation progresses without a new DOM mutation.
      revealed = true;
      section.dispatchEvent(new Event(eventName, { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1_500);
      expect(document.querySelector('p')!.textContent).toContain('延迟显示的内容');
      session.pause();
      document.querySelector('p')!.remove();
      section.innerHTML = '<p>After pausing.</p>';
      section.dispatchEvent(new Event(eventName, { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1_500);
      expect(translateBatchViaPort).toHaveBeenCalledTimes(1);
    } finally {
      session.dispose('stop');
      vi.restoreAllMocks();
    }
  });

  it('collects labelled animation text despite continuous fragment style updates', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><p aria-label="Animated paragraph content."><span aria-hidden="true" style="opacity:0">Animated paragraph content.</span></p></main>';
    vi.mocked(translateBatchViaPort).mockResolvedValue(['动画段落内容。']);
    const session = new ContentSession(config());
    const line = document.querySelector('span')!;
    let tick = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await session.start();
      timer = setInterval(() => { line.style.opacity = ++tick % 2 ? '0.1' : '1'; }, 50);
      await vi.advanceTimersByTimeAsync(1_500);
      expect(document.querySelector('p')!.textContent).toContain('动画段落内容。');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(translateBatchViaPort).toHaveBeenCalledTimes(1);
      expect(session.status()).toMatchObject({ total: 1, count: 1 });
    } finally {
      clearInterval(timer);
      session.dispose('stop');
    }
  });

  it.each(['AUTH_INVALID', 'MODEL_PARAMETERS_INVALID'] as const)('sends %s straight to terminal (no auto retry)', async (code) => {
    vi.useFakeTimers();
    paragraphs(1);
    vi.mocked(translateBatchViaPort).mockRejectedValue(
      new TapTranslateError(code),
    );
    const session = new ContentSession(config());
    const startP = session.start();
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await startP;
    expect(result.success).toBe(true);
    expect(result.failed).toBe(1);
    expect(vi.mocked(translateBatchViaPort)).toHaveBeenCalledTimes(1);
    expect(session.status().translating).toBe(false);
    session.dispose('stop');
  });

  it('recovers from an aborted upstream connection through the retry queue', async () => {
    vi.useFakeTimers();
    paragraphs(1);
    vi.mocked(translateBatchViaPort)
      .mockRejectedValueOnce(new TapTranslateError('NETWORK_ERROR', { detail: 'The operation was aborted.' }))
      .mockResolvedValueOnce(['恢复后的译文']);
    const session = new ContentSession(config());
    try {
      const result = session.start();
      await vi.advanceTimersByTimeAsync(400);
      expect(session.status().translating).toBe(true);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(translateBatchViaPort).toHaveBeenCalledTimes(2);
      expect(await result).toMatchObject({ success: true, count: 1, failed: 0 });
      expect(session.status().translating).toBe(false);
      expect(document.body.textContent).toContain('恢复后的译文');
    } finally {
      session.dispose('stop');
    }
  });

  it('pause clears pending retries so status stops translating', async () => {
    vi.useFakeTimers();
    paragraphs(1);
    vi.mocked(translateBatchViaPort).mockRejectedValue(
      new TapTranslateError('UPSTREAM_UNAVAILABLE', { detail: 'HTTP 500' }),
    );
    const session = new ContentSession(config());
    const startP = session.start();
    await vi.advanceTimersByTimeAsync(400);
    expect(session.status().translating).toBe(true); // retry pending
    session.pause();
    expect(session.status().translating).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await startP;
    session.dispose('stop');
  });

  it('pause strands no in-flight entry: resumeWatch re-dispatches it', async () => {
    vi.useFakeTimers();
    paragraphs(1);
    hangingPort();
    const session = new ContentSession(config());
    const startP = session.start();
    await vi.advanceTimersByTimeAsync(400);
    expect(vi.mocked(translateBatchViaPort)).toHaveBeenCalledTimes(1);
    session.pause();
    await vi.advanceTimersByTimeAsync(50);
    expect(session.status().translating).toBe(false);

    vi.mocked(translateBatchViaPort).mockResolvedValue(['译文句子一。']);
    session.resumeWatch();
    await vi.advanceTimersByTimeAsync(400);
    expect(vi.mocked(translateBatchViaPort)).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await startP;
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    session.dispose('stop');
  });

  it('pause does not dispatch the queued remainder of a full pipeline', async () => {
    vi.useFakeTimers();
    paragraphs(9); // batchSize 4 × concurrency 2 → 8 in flight, 1 queued
    hangingPort();
    const session = new ContentSession(config());
    const startP = session.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(vi.mocked(translateBatchViaPort)).toHaveBeenCalledTimes(2);
    session.pause();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(vi.mocked(translateBatchViaPort)).toHaveBeenCalledTimes(2);
    expect(session.status().translating).toBe(false);
    session.dispose('stop');
    await vi.advanceTimersByTimeAsync(10_000);
    await startP;
  });

  it('translates an unadapted page and later additions after navigation from a matched layout', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><p class="prose">Adapted page paragraph.</p><p>Outside scope.</p></main>';
    vi.mocked(translateBatchViaPort).mockImplementation(async texts => texts.map(text => `译:${text}`));
    const session = new ContentSession(config({
      siteContentRule: { host: location.hostname, content: ['.prose'], ignore: ['.skip'] },
    }));
    try {
      const start = session.start();
      await vi.advanceTimersByTimeAsync(1800);
      expect((await start).count).toBe(1);
      expect(document.querySelectorAll('.tap-translate-target')).toHaveLength(1);

      document.querySelector('main')!.innerHTML = '<p id="fallback">Unadapted page paragraph.</p><p class="skip">Keep original.</p><button>Save settings.</button>';
      await vi.advanceTimersByTimeAsync(1800);
      expect(document.querySelector('#fallback .tap-translate-target')?.textContent).toBe('译:Unadapted page paragraph.');
      expect(document.querySelectorAll('.tap-translate-target')).toHaveLength(1);

      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<p id="added">Later page paragraph.</p>');
      await vi.advanceTimersByTimeAsync(1800);
      expect(document.querySelector('#added .tap-translate-target')?.textContent).toBe('译:Later page paragraph.');
      expect(vi.mocked(translateBatchViaPort).mock.calls.map(([texts]) => texts)).toEqual([
        ['Adapted page paragraph.'], ['Unadapted page paragraph.'], ['Later page paragraph.'],
      ]);
    } finally {
      session.dispose('restore');
    }
  });

  it('a new content revision cancels old requests, restores DOM and installs a fresh policy', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><p class="old">Old article sentence.</p><p class="next">New article sentence.</p></main>';
    let late: ((value: string[]) => void) | undefined;
    vi.mocked(translateBatchViaPort).mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
    const first = translatePage(config({ siteContentRule: { host: location.hostname, content: ['.old'] } }));
    await vi.advanceTimersByTimeAsync(400);
    const old = getActiveSession()!;
    const oldSignal = vi.mocked(translateBatchViaPort).mock.calls[0]![1]!.signal!;
    vi.mocked(translateBatchViaPort).mockResolvedValue(['新规则译文']);
    const next = translatePage(config({ sessionId: 'next', revision: 2, siteContentRule: { host: location.hostname, content: ['.next'] } }));
    await vi.advanceTimersByTimeAsync(1800);
    expect(old.alive).toBe(false); expect(oldSignal.aborted).toBe(true);
    late!(['迟到的旧译文']);
    await vi.advanceTimersByTimeAsync(9000);
    await first; await next;
    expect(document.body.textContent).not.toContain('迟到的旧译文');
    expect(document.querySelector('.old .tap-translate-target')).toBeNull();
    expect(document.querySelector('.next .tap-translate-target')!.textContent).toBe('新规则译文');
    const reset = translatePage(config({ revision: 3, siteContentRule: { host: location.hostname, content: [] } }));
    await vi.advanceTimersByTimeAsync(9000); await reset;
    expect(document.querySelector('.tap-translate-target')).toBeNull();
    expect(document.querySelector('.next')!.textContent).toBe('New article sentence.');
    expect(getActiveSession()!.status().total).toBe(0);
    restoreOriginal();
  });
});
