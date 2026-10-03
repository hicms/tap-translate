import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../lib/types';
import {
  getSettings,
  saveSettings,
  effectiveForHost,
  hostOf,
  upsertSiteRule,
} from '../../lib/settings/storage';
import { buildPublicSessionConfig } from '../../lib/settings/session-config';
import { clearPendingSiteAuto, stagePendingSiteAuto } from '../../lib/settings/pending-site-auto';
import { ensureContentScript, isRestrictedUrl, originPattern, sendToContentFrames } from '../../lib/inject';
import { isConnectionConfigured } from '../../lib/provider/connection';
import { openOnboardingPage } from '../../lib/settings/onboarding';
import { derivePopupView, type PopupSnapshot, type PrimaryAction } from '../../lib/popup/state';

type SitePolicy = 'global' | 'auto' | 'never';
const currentTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

export function usePopup(initial: Settings) {
  const [preferences, setPreferences] = useState({ targetLang: initial.targetLang, mode: initial.mode });
  const [policy, setPolicy] = useState<SitePolicy>('global');
  const [policySaving, setPolicySaving] = useState(false);
  const [host, setHost] = useState('');
  const [snapshot, setSnapshot] = useState<PopupSnapshot>({
    configured: isConnectionConfigured(initial),
    hasTab: false,
    restricted: false,
    siteDisabled: false,
    translating: false,
    watching: false,
    count: 0,
    total: 0,
    failed: 0,
  });
  const [restored, setRestored] = useState(false);
  const state = useRef(snapshot);
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function patch(value: Partial<PopupSnapshot>) {
    state.current = { ...state.current, ...value };
    if (alive.current) setSnapshot(state.current);
  }
  function load(settings: Settings, hostname: string) {
    const effective = effectiveForHost(settings, hostname);
    setPreferences({ targetLang: effective.targetLang, mode: effective.mode });
    setPolicy(effective.disabled ? 'never' : effective.auto ? 'auto' : 'global');
    patch({ configured: isConnectionConfigured(settings), siteDisabled: effective.disabled });
  }
  async function refresh() {
    const version = ++requestVersion.current;
    const tab = await currentTab();
    if (!alive.current || version !== requestVersion.current) return;
    patch({ hasTab: Boolean(tab?.id), restricted: isRestrictedUrl(tab?.url), injectFailed: false });
    if (!state.current.configured || !tab?.id || state.current.restricted || state.current.siteDisabled)
      return;
    const ok = await ensureContentScript(tab.id);
    if (!alive.current || version !== requestVersion.current) return;
    if (!ok) {
      patch({ injectFailed: true, translating: false, watching: false });
      return;
    }
    const status = await sendToContentFrames(tab.id, { action: 'getStatus' });
    if (!alive.current || version !== requestVersion.current) return;
    patch({
      translating: Boolean(status.translating),
      watching: Boolean(status.watching),
      count: Number(status.count) || 0,
      total: Number(status.total) || 0,
      failed: Number(status.failed) || 0,
    });
  }
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    alive.current = true;
    void currentTab()
      .then((tab) => {
        if (!alive.current) return;
        const hostname = hostOf(tab?.url);
        setHost(hostname);
        load(initial, hostname);
        return refreshRef.current();
      })
      .catch((error) => patch({ lastError: String(error) }));
    return () => {
      alive.current = false;
      requestVersion.current++;
      clearTimeout(restoreTimer.current);
    };
  }, [initial]);
  const polling = Boolean(
    snapshot.busy ||
      snapshot.translating ||
      (snapshot.watching && snapshot.count + snapshot.failed < snapshot.total),
  );
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      void refreshRef.current().catch((error) => patch({ lastError: String(error) }));
    }, 400);
    return () => clearInterval(timer);
  }, [polling]);

  async function changePreferences(next: typeof preferences) {
    setPreferences(next);
    try {
      await saveSettings(next);
      await refresh();
    } catch (error) {
      patch({ lastError: String(error) });
    }
  }
  async function act(action: PrimaryAction) {
    try {
      setRestored(false);
      clearTimeout(restoreTimer.current);
      if (action === 'setup') {
        openOnboardingPage();
        return;
      }
      if (action === 'none') return;
      const settings = action === 'translate' ? await saveSettings(preferences) : initial;
      const tab = await currentTab();
      if (!tab?.id) {
        patch({ hasTab: false });
        return;
      }
      if (isRestrictedUrl(tab.url)) {
        patch({ restricted: true });
        return;
      }
      if (action === 'translate') {
        load(settings, host);
        if (!isConnectionConfigured(settings)) {
          openOnboardingPage();
          return;
        }
        if (state.current.siteDisabled) return;
        patch({ busy: true, lastEmpty: false, lastError: null, lastErrorCode: null });
      }
      if (!(await ensureContentScript(tab.id))) {
        patch({ injectFailed: true, busy: false });
        return;
      }
      if (action === 'translate') {
        const effective = effectiveForHost(settings, host);
        const config = await buildPublicSessionConfig(settings, host, {
          mode: effective.mode,
          targetLang: preferences.targetLang,
        });
        const result = await sendToContentFrames(tab.id, { action: 'translatePage', config });
        if (!result.success) {
          patch({
            lastError: String(result.error || 'Translation failed'),
            lastErrorCode: typeof result.code === 'string' ? result.code : null,
            translating: false,
          });
        } else {
          patch({
            watching: Boolean(result.watching),
            count: Number(result.count) || 0,
            total: Number(result.total) || 0,
            failed: Number(result.failed) || 0,
            lastEmpty: result.count === 0 && result.total === 0,
          });
        }
      } else if (action === 'restore') {
        await sendToContentFrames(tab.id, { action: 'restoreOriginal' });
        patch({
          translating: false,
          watching: false,
          count: 0,
          total: 0,
          failed: 0,
          lastError: null,
          lastErrorCode: null,
          lastEmpty: false,
          busy: false,
        });
        setRestored(true);
        restoreTimer.current = setTimeout(() => setRestored(false), 600);
      } else if (action === 'stop') {
        await sendToContentFrames(tab.id, { action: 'stopWatch' });
        patch({ busy: false, translating: false });
      } else if (action === 'retryFailed') {
        patch({ busy: true });
        await sendToContentFrames(tab.id, { action: 'retryFailed' });
      }
    } catch (error) {
      patch({ lastError: error instanceof Error ? error.message : String(error) });
    } finally {
      patch({ busy: false });
      await refresh().catch((error) => patch({ lastError: String(error) }));
    }
  }
  async function changePolicy(next: SitePolicy) {
    if (!host || !state.current.configured || policySaving) return;
    setPolicySaving(true);
    try {
      if (next === 'auto') {
        const tab = await currentTab();
        const origin = tab?.url ? originPattern(tab.url) : null;
        if (!tab?.id || !origin) return;
        // Persist the intent before the permission dialog can close the popup.
        await stagePendingSiteAuto({ tabId: tab.id, host, origin, createdAt: Date.now() });
        if (!(await chrome.permissions.request({ origins: [origin] }).catch(() => false))) {
          await clearPendingSiteAuto(tab.id);
          return;
        }
        void chrome.runtime
          .sendMessage({ action: 'activatePendingSiteAuto', tabId: tab.id })
          .catch(() => undefined);
        setPolicy('auto');
      } else {
        load(await upsertSiteRule(host, { disabled: next === 'never', auto: false }), host);
      }
    } catch (error) {
      patch({ lastError: String(error) });
      try {
        load(await getSettings(), host);
      } catch {
        setPolicy('global');
      }
    } finally {
      setPolicySaving(false);
      await refresh().catch((error) => patch({ lastError: String(error) }));
    }
  }
  return {
    snapshot,
    view: derivePopupView(snapshot),
    preferences,
    policy,
    policySaving,
    restored,
    changePreferences,
    changePolicy,
    act,
  };
}
