import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button } from '@astryxdesign/core/Button';
import { ThemeContext } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import resetCSS from '@astryxdesign/core/reset.css?inline';
import componentCSS from '@astryxdesign/core/astryx.css?inline';
import themeCSS from '@astryxdesign/theme-neutral/theme.css?inline';
import overlayCSS from './style.css?inline';

export interface OverlayLabels {
  title: string;
  copy: string;
  close: string;
}
interface OverlayView {
  original: string;
  text: string;
  state: 'loading' | 'result' | 'error';
  labels: OverlayLabels;
}
interface OverlayMount {
  host: HTMLElement;
  shadow: ShadowRoot;
  root: Root;
  previousFocus: Element | null;
}
const HOST_ID = 'tap-translate-overlay-host';
const OUTSIDE_GRACE_MS = 400;
// Shadow roots have no :root. Keep token defaults and every reset/component
// rule inside the shadow tree; no stylesheet or theme attribute touches the page.
const css = [resetCSS, componentCSS, themeCSS].join('\n').replaceAll(':root', ':host') + '\n' + overlayCSS;
const theme = { theme: neutralTheme, mode: 'system' as const };
let mounted: OverlayMount | null = null;
let listenerTimer: ReturnType<typeof setTimeout> | undefined;
let ignoreOutsideUntil = 0;

function Panel({ original, text, state, labels }: OverlayView) {
  return (
    <ThemeContext value={theme}>
      <style>{css}</style>
      <div data-astryx-theme="neutral" className="dr-theme">
        <div
          className="dr-panel"
          role="dialog"
          aria-labelledby="dr-overlay-title"
          aria-describedby="dr-overlay-body"
          tabIndex={-1}
        >
          <header className="dr-head">
            <span id="dr-overlay-title" className="dr-title">
              {labels.title}
            </span>
            <div className="dr-actions">
              <Button
                className="dr-btn"
                size="sm"
                variant="ghost"
                label={labels.copy}
                aria-label={labels.copy}
                isDisabled={state !== 'result'}
                onClick={() => {
                  void navigator.clipboard?.writeText(text).catch(() => undefined);
                }}
              />
              <Button
                className="dr-btn"
                size="sm"
                variant="ghost"
                label={labels.close}
                aria-label={labels.close}
                onClick={hideOverlay}
              />
            </div>
          </header>
          <p className="dr-original">{original}</p>
          <p
            id="dr-overlay-body"
            className={`dr-body${state === 'result' ? '' : ` dr-${state}`}`}
            role={state === 'error' ? 'alert' : 'status'}
          >
            {text}
          </p>
        </div>
      </div>
    </ThemeContext>
  );
}

function onOutside(event: Event) {
  if (mounted && Date.now() >= ignoreOutsideUntil && !event.composedPath().includes(mounted.host))
    hideOverlay();
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') hideOverlay();
}

function ensureOverlay(): OverlayMount {
  if (mounted?.host.isConnected) return mounted;
  hideOverlay();
  const host = document.createElement('div');
  host.id = HOST_ID;
  // Host-page selectors can match the mount itself. Its own box must neither
  // participate in page layout nor block pointer events outside the panel.
  host.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const previousFocus = document.activeElement;
  document.documentElement.append(host);
  mounted = { host, shadow, root: createRoot(shadow), previousFocus };
  listenerTimer = setTimeout(() => {
    listenerTimer = undefined;
    if (!mounted || mounted.host !== host || !host.isConnected) return;
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    shadow.querySelector<HTMLElement>('.dr-panel')!.focus();
  }, 0);
  return mounted;
}

function position(panel: HTMLElement) {
  const selection = window.getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const margin = 12;
  const width = Math.min(360, window.innerWidth - margin * 2);
  panel.style.maxWidth = `${width}px`;
  panel.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
  if (rect && (rect.width || rect.height)) {
    panel.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    panel.style.right = 'auto';
    const height = panel.getBoundingClientRect().height;
    const below = rect.bottom + 8;
    panel.style.top = `${below + height <= window.innerHeight - margin ? below : Math.max(margin, Math.min(rect.top - height - 8, window.innerHeight - height - margin))}px`;
  } else {
    panel.style.top = `${margin}px`;
    panel.style.right = `${margin}px`;
    panel.style.left = 'auto';
  }
}

function render(view: OverlayView) {
  const mount = ensureOverlay();
  ignoreOutsideUntil = Date.now() + OUTSIDE_GRACE_MS;
  // Content-session callers synchronously inspect the overlay after updates.
  flushSync(() => mount.root.render(<Panel {...view} />));
  position(mount.shadow.querySelector<HTMLElement>('.dr-panel')!);
}
export function showLoading(original: string, labels: OverlayLabels): void {
  render({ original, text: '…', state: 'loading', labels });
}
export function showResult(original: string, text: string, labels: OverlayLabels): void {
  render({ original, text, state: 'result', labels });
}
export function showError(original: string, text: string, labels: OverlayLabels): void {
  render({ original, text, state: 'error', labels });
}

export function hideOverlay(): void {
  clearTimeout(listenerTimer);
  listenerTimer = undefined;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  const mount = mounted;
  mounted = null;
  if (mount) {
    const restoreFocus = document.activeElement === mount.host;
    mount.root.unmount();
    mount.host.remove();
    if (restoreFocus && mount.previousFocus instanceof HTMLElement && mount.previousFocus.isConnected)
      mount.previousFocus.focus({ preventScroll: true });
  }
}
