// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideOverlay, showError, showLoading, showResult } from '../lib/overlay';

const labels = { title: 'TapTranslate', copy: 'Copy', close: 'Close' };

afterEach(() => {
  hideOverlay();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('selection overlay', () => {
  it('ignores outside mousedown during the context-menu grace period', () => {
    vi.useFakeTimers();
    showLoading('hello world', labels);
    const host = document.getElementById('tap-translate-overlay-host');
    expect(host).toBeTruthy();

    // Same gesture that dismissed the context menu.
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.getElementById('tap-translate-overlay-host')).toBeTruthy();

    vi.advanceTimersByTime(450);
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.getElementById('tap-translate-overlay-host')).toBeNull();
  });

  it('keeps the panel after a result update within the grace window', () => {
    vi.useFakeTimers();
    showLoading('hello', labels);
    showResult('hello', '你好', labels);
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.getElementById('tap-translate-overlay-host')).toBeTruthy();
    const body = document
      .getElementById('tap-translate-overlay-host')!
      .shadowRoot!
      .querySelector('.dr-body');
    expect(body?.textContent).toBe('你好');
  });

  it('reuses one host across repeated selection translations', () => {
    vi.useFakeTimers();
    showLoading('first selection', labels);
    showResult('first selection', '第一段', labels);
    showLoading('second selection', labels);
    showResult('second selection', '第二段', labels);

    const hosts = document.querySelectorAll('#tap-translate-overlay-host');
    expect(hosts).toHaveLength(1);
    expect(hosts[0].shadowRoot?.querySelector('.dr-original')?.textContent)
      .toBe('second selection');
    expect(hosts[0].shadowRoot?.querySelector('.dr-body')?.textContent)
      .toBe('第二段');
  });

  it('refreshes visible and accessible labels when reusing the overlay', () => {
    vi.useFakeTimers();
    showLoading('hello', labels);
    const host = document.getElementById('tap-translate-overlay-host')!;
    const localized = { title: '翻译', copy: '复制', close: '关闭' };

    showLoading('hello', localized);

    expect(document.querySelectorAll('#tap-translate-overlay-host')).toHaveLength(1);
    expect(host.shadowRoot?.querySelector('.dr-title')?.textContent).toBe('翻译');
    const buttons = host.shadowRoot?.querySelectorAll<HTMLButtonElement>('.dr-btn');
    expect(buttons?.[0].textContent).toBe('复制');
    expect(buttons?.[0].getAttribute('aria-label')).toBe('复制');
    expect(buttons?.[1].textContent).toBe('关闭');
    expect(buttons?.[1].getAttribute('aria-label')).toBe('关闭');
  });

  it('cancels deferred document listeners when hidden immediately', () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(document, 'addEventListener');
    try {
      showLoading('short-lived selection', labels);
      hideOverlay();
      // Astryx installs and tears down its own immediate keyboard-modality
      // listeners. No deferred overlay dismissal listener may attach later.
      expect(addListener.mock.calls.map(([type]) => type)).not.toContain('mousedown');
      addListener.mockClear();
      vi.runAllTimers();

      const eventTypes = addListener.mock.calls.map(([type]) => type);
      expect(eventTypes).not.toContain('mousedown');
      expect(eventTypes).not.toContain('keydown');
      expect(document.getElementById('tap-translate-overlay-host')).toBeNull();
    } finally {
      addListener.mockRestore();
    }
  });

  it('escapes text, copies results, isolates theme attributes and restores keyboard focus', () => {
    vi.useFakeTimers();
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    window.getSelection()?.removeAllRanges();
    const attrs = document.documentElement.getAttributeNames().map(name => [name, document.documentElement.getAttribute(name)]);
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    showResult('<img src=x onerror=alert(1)>', '<script>hello</script>', labels);
    const shadow = document.getElementById('tap-translate-overlay-host')!.shadowRoot!;
    expect(shadow.querySelector('img,script')).toBeNull();
    shadow.querySelector<HTMLButtonElement>('.dr-btn')!.click();
    expect(copy).toHaveBeenCalledWith('<script>hello</script>');
    expect(document.documentElement.getAttributeNames().map(name => [name, document.documentElement.getAttribute(name)])).toEqual(attrs);
    expect(document.head.querySelector('[data-astryx-theme]')).toBeNull();
    showError('source', 'failed', labels);
    expect(shadow.querySelector<HTMLButtonElement>('.dr-btn')!.disabled).toBe(true);
    vi.advanceTimersByTime(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('tap-translate-overlay-host')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
