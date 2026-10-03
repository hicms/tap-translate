import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { getUiMessage } from '../lib/i18n';
import type { UiLocale } from '../lib/types';

const LocaleContext = createContext<UiLocale>('en');
export type Translate = (key: string, subs?: (string | number)[]) => string;

export function LocaleProvider({
  locale,
  title,
  children,
}: {
  locale: UiLocale;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = getUiMessage(title, null, locale);
  }, [locale, title]);
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale() {
  const locale = useContext(LocaleContext);
  const t: Translate = (key, subs) => getUiMessage(key, subs, locale);
  return { locale, t };
}

export function languageKey(code: string, kind: 'target' | 'ui' = 'target'): string {
  const compact = code.replace('-', '');
  return `${kind === 'target' ? 'targetLanguage' : 'uiLanguage'}${compact[0]!.toUpperCase()}${compact.slice(1)}`;
}
