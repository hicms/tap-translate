import type { ProviderConfig, ProviderModel } from '../../lib/types';
import { parseThinkingPatch } from '../../lib/settings/thinking-override';
import { resolveThinking } from '../../lib/provider/thinking';

interface Draft { enabled: string; disabled: string; custom: boolean; invalid: boolean }

export function mountThinkingEditor(t: (key: string) => string, changed: () => void) {
  const mode = document.getElementById('thinking') as HTMLSelectElement;
  const effort = document.getElementById('reasoningEffort') as HTMLSelectElement;
  const adapter = document.getElementById('thinkingAdapter') as HTMLSelectElement;
  const enabled = document.getElementById('thinkingEnabledBody') as HTMLTextAreaElement;
  const disabled = document.getElementById('thinkingDisabledBody') as HTMLTextAreaElement;
  const hint = document.getElementById('thinkingHint')!;
  const error = document.getElementById('thinkingError')!;
  // Object identity scopes drafts to provider + model and lets deleted models
  // disappear naturally. Reload and reset explicitly clear their drafts.
  let drafts = new WeakMap<ProviderModel, Draft>();

  for (const input of [adapter, mode, effort]) input.addEventListener('change', changed);
  for (const input of [enabled, disabled]) input.addEventListener('input', changed);

  return {
    clear() { drafts = new WeakMap(); },
    reset(model: ProviderModel) { drafts.delete(model); },
    capture(model: ProviderModel) {
      const draft: Draft = { enabled: enabled.value, disabled: disabled.value, custom: adapter.value === 'custom', invalid: false };
      enabled.setCustomValidity('');
      disabled.setCustomValidity('');
      if (draft.custom) {
        try {
          model.parameters.thinkingOverride = { enabled: parseThinkingPatch(draft.enabled), disabled: parseThinkingPatch(draft.disabled) };
        } catch {
          draft.invalid = true;
          for (const input of [enabled, disabled]) {
            try { parseThinkingPatch(input.value); } catch { input.setCustomValidity(t('thinkingJsonInvalid')); }
          }
        }
      } else model.parameters.thinkingOverride = null;
      drafts.set(model, draft);
    },
    fill(model: ProviderModel) {
      const override = model.parameters.thinkingOverride;
      const draft = drafts.get(model);
      adapter.value = (draft?.custom ?? Boolean(override)) ? 'custom' : 'auto';
      enabled.value = draft?.enabled ?? JSON.stringify(override?.enabled === undefined ? { enable_thinking: true } : override.enabled, null, 2);
      disabled.value = draft?.disabled ?? JSON.stringify(override?.disabled === undefined ? { enable_thinking: false } : override.disabled, null, 2);
      enabled.setCustomValidity('');
      disabled.setCustomValidity('');
      this.capture(model);
    },
    issue(provider: ProviderConfig, model: ProviderModel): string | null {
      if (drafts.get(model)?.invalid) return 'thinkingJsonInvalid';
      return resolveThinking({ apiBase: provider.apiBase, model: model.name, modelParameters: model.parameters }).issue;
    },
    hasInvalidDraft(providers: ProviderConfig[]) {
      return providers.some((provider) => provider.models.some((model) => drafts.get(model)?.invalid));
    },
    refresh(provider: ProviderConfig, model: ProviderModel) {
      const state = resolveThinking({ apiBase: provider.apiBase, model: model.name, modelParameters: model.parameters });
      const custom = adapter.value === 'custom';
      document.getElementById('thinkingCustomFields')!.hidden = !custom;
      enabled.disabled = disabled.disabled = !custom;
      mode.querySelector<HTMLOptionElement>('option[value="enabled"]')!.disabled = state.profile.enabled === null;
      mode.querySelector<HTMLOptionElement>('option[value="disabled"]')!.disabled = state.profile.disabled === null;
      effort.disabled = custom || !state.profile.efforts.length || mode.value === 'disabled'
        || (mode.value === 'auto' && state.profile.automatic === 'disabled');
      for (const option of Array.from(effort.options)) {
        option.disabled = option.value !== 'auto' && !state.profile.efforts.some((value) => value === option.value);
      }
      hint.textContent = t(state.profile.hintKey);
      const issue = this.issue(provider, model);
      error.textContent = issue ? t(issue) : '';
      error.hidden = !issue;
      mode.setCustomValidity(issue && issue !== 'thinkingJsonInvalid' ? t(issue) : '');
    },
  };
}
