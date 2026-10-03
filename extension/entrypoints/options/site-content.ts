import type { SiteContentRule } from '../../lib/types';
import { normalizeSiteHost } from '../../lib/settings/schema';
import { resolveSiteProfile } from '../../lib/sites';
import { resolveContentPolicy } from '../../lib/sites/policy';
import { normalizeSiteContentRules, SiteContentValidationError, type SelectorField } from '../../lib/sites/validation';
import { checkCurrentPage } from './site-content-check';

type Translate = (key: string, subs?: (string | number)[]) => string;
let sequence = 0;

function button(key: string, t: Translate, action: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button'; el.className = 'btn-secondary btn-sm';
  el.textContent = t(key); el.dataset.i18n = key; el.addEventListener('click', action);
  return el;
}

export function contentRuleFromCard(card: HTMLElement, validate = false): SiteContentRule {
  const rule: SiteContentRule = { host: normalizeSiteHost(card.querySelector<HTMLInputElement>('[data-field="host"]')!.value) };
  for (const field of ['content', 'ignore'] as const) {
    if (card.querySelector<HTMLSelectElement>(`[data-rule-mode="${field}"]`)?.value === 'custom') {
      rule[field] = card.querySelector<HTMLTextAreaElement>(`[data-selectors="${field}"]`)!.value.split('\n');
    }
  }
  const errorEl = card.querySelector<HTMLElement>('.content-error')!;
  if (validate) card.querySelectorAll('[data-selectors]').forEach(el => el.removeAttribute('aria-invalid'));
  try {
    const result = normalizeSiteContentRules([rule], validate ? document : null);
    if (validate) errorEl.textContent = '';
    return result[0] ?? { host: rule.host };
  } catch (error) {
    if (validate && error instanceof SiteContentValidationError && error.field) {
      const input = card.querySelector<HTMLTextAreaElement>(`[data-selectors="${error.field}"]`)!;
      input.setAttribute('aria-invalid', 'true');
    }
    throw error;
  }
}

export function contentErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof SiteContentValidationError) {
    return t(error.code === 'syntax' ? 'contentSyntaxError' : 'contentLimitError', [
      error.field ? t(error.field === 'content' ? 'contentSelectors' : 'ignoreSelectors') : t('contentRules'), error.line ?? 1,
    ]);
  }
  return error instanceof Error ? error.message : String(error);
}

export function mountContentEditor(card: HTMLElement, override: SiteContentRule | undefined, t: Translate, changed: () => void): void {
  const id = `content-rule-${++sequence}`;
  const details = document.createElement('section'); details.className = 'content-editor'; details.dataset.editorPanel = 'content';
  const help = document.createElement('p'); help.className = 'hint'; help.textContent = t('contentHelp'); help.dataset.i18n = 'contentHelp';
  const error = document.createElement('p'); error.id = `${id}-error`; error.className = 'content-error'; error.setAttribute('role', 'alert');
  const effective = document.createElement('pre'); effective.className = 'content-effective'; effective.setAttribute('aria-label', t('contentEffective'));
  const host = () => card.querySelector<HTMLInputElement>('[data-field="host"]')!.value;
  const resets: (() => void)[] = [];
  const update = () => {
    results.textContent = '';
    try {
      const rule = contentRuleFromCard(card);
      const policy = resolveContentPolicy(rule.host, rule);
      const content = policy.content.mode === 'generic' ? t('contentGeneric') : policy.content.mode === 'none' ? t('contentEmpty') : policy.content.selectors.join('\n');
      effective.textContent = `${t('contentSelectors')}\n${content}\n\n${t('ignoreSelectors')}\n${policy.ignore.join('\n') || t('ignoreEmpty')}`;
    } catch { /* Drafts are validated on Save / Check. */ }
  };
  details.append(help);
  for (const field of ['content', 'ignore'] as const satisfies readonly SelectorField[]) {
    const wrapper = document.createElement('div'); wrapper.className = 'field';
    const label = document.createElement('label'); label.htmlFor = `${id}-${field}`; label.dataset.i18n = field === 'content' ? 'contentSelectors' : 'ignoreSelectors'; label.textContent = t(label.dataset.i18n);
    const mode = document.createElement('select'); mode.dataset.ruleMode = field; mode.setAttribute('aria-label', `${label.textContent}: ${t('contentSource')}`);
    const builtin = resolveSiteProfile(host());
    mode.add(new Option(t(builtin ? 'contentInheritBuiltin' : 'contentInheritGeneric'), 'inherit'));
    mode.add(new Option(t('contentCustom'), 'custom'));
    mode.options[0]!.dataset.i18n = builtin ? 'contentInheritBuiltin' : 'contentInheritGeneric';
    mode.options[1]!.dataset.i18n = 'contentCustom';
    const textarea = document.createElement('textarea'); textarea.id = label.htmlFor; textarea.dataset.selectors = field; textarea.rows = 3; textarea.spellcheck = false;
    textarea.setAttribute('aria-describedby', `${id}-${field}-help ${error.id}`);
    const note = document.createElement('p'); note.id = `${id}-${field}-help`; note.className = 'hint'; note.dataset.i18n = field === 'content' ? 'contentEmptyHint' : 'ignoreEmptyHint'; note.textContent = t(note.dataset.i18n);
    const reset = () => {
      mode.value = 'inherit'; textarea.disabled = true; textarea.value = resolveSiteProfile(host())?.[field].join('\n') ?? '';
    };
    resets.push(reset); reset();
    if (override?.[field] !== undefined) { mode.value = 'custom'; textarea.disabled = false; textarea.value = override[field]!.join('\n'); }
    mode.addEventListener('change', () => {
      if (mode.value === 'inherit') reset(); else textarea.disabled = false;
      update(); changed();
    });
    textarea.addEventListener('input', () => { error.textContent = ''; textarea.removeAttribute('aria-invalid'); update(); });
    const heading = document.createElement('div'); heading.className = 'content-field-head'; heading.append(label, mode);
    const caption = document.createElement('div'); caption.className = 'content-field-caption'; caption.append(note, button('contentResetField', t, () => { reset(); update(); changed(); }));
    wrapper.append(heading, textarea, caption);
    details.append(wrapper);
  }
  const effectiveDetails = document.createElement('details');
  const effectiveSummary = document.createElement('summary'); effectiveSummary.textContent = t('contentEffective'); effectiveSummary.dataset.i18n = 'contentEffective';
  const protections = document.createElement('p'); protections.className = 'hint'; protections.textContent = t('contentProtections'); protections.dataset.i18n = 'contentProtections';
  effectiveDetails.append(effectiveSummary, effective, protections);
  const results = document.createElement('div'); results.className = 'content-check-results'; results.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div'); actions.className = 'actions-inline';
  const check = button('contentCheck', t, () => {
    void (async () => {
      check.disabled = true;
      try {
        const draft = contentRuleFromCard(card, true);
        const result = await checkCurrentPage(draft);
        if (!card.isConnected || JSON.stringify(contentRuleFromCard(card)) !== JSON.stringify(draft)) return;
        results.textContent = `${t('contentCheckResult', [result.host])}\n${[...result.content.map(item => `${t('contentSelectors')}: ${item.selector} — ${item.count}`), ...result.ignore.map(item => `${t('ignoreSelectors')}: ${item.selector} — ${item.count}`)].join('\n') || t(result.mode === 'none' ? 'contentEmpty' : 'contentGeneric')}`;
      } catch (err) {
        error.textContent = err instanceof Error && err.message.startsWith('CHECK_') ? t(err.message) : contentErrorMessage(err, t);
      } finally { check.disabled = false; }
    })();
  });
  actions.append(button('contentResetAll', t, () => { resets.forEach(reset => reset()); update(); changed(); }), check);
  const checkHelp = document.createElement('p'); checkHelp.className = 'hint'; checkHelp.textContent = t('contentCheckHelp'); checkHelp.dataset.i18n = 'contentCheckHelp';
  details.prepend(actions, error, results);
  details.append(effectiveDetails, checkHelp); card.append(details); update();
  card.addEventListener('content-locale', () => {
    update();
    effective.setAttribute('aria-label', t('contentEffective'));
    for (const field of ['content', 'ignore'] as const) {
      card.querySelector(`[data-rule-mode="${field}"]`)!.setAttribute('aria-label', `${t(field === 'content' ? 'contentSelectors' : 'ignoreSelectors')}: ${t('contentSource')}`);
    }
  });
  card.querySelector('[data-field="host"]')!.addEventListener('change', () => {
    for (const field of ['content', 'ignore'] as const) {
      const mode = card.querySelector<HTMLSelectElement>(`[data-rule-mode="${field}"]`)!;
      mode.options[0]!.dataset.i18n = resolveSiteProfile(host()) ? 'contentInheritBuiltin' : 'contentInheritGeneric';
      mode.options[0]!.textContent = t(mode.options[0]!.dataset.i18n!);
      if (mode.value === 'inherit') card.querySelector<HTMLTextAreaElement>(`[data-selectors="${field}"]`)!.value = resolveSiteProfile(host())?.[field].join('\n') ?? '';
    }
    update();
  });
}

export function collectContentRules(container: HTMLElement, t: Translate, validate = false): SiteContentRule[] {
  const rules = Array.from(container.querySelectorAll<HTMLElement>('.site-card'), card => {
    try { return contentRuleFromCard(card, validate); }
    catch (error) {
      if (validate) card.querySelector<HTMLElement>('.content-error')!.textContent = contentErrorMessage(error, t);
      throw error;
    }
  });
  return normalizeSiteContentRules(rules, validate ? document : null);
}
