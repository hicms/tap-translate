import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import zhCN from '@astryxdesign/core/locales/zh-CN.json';
import zhTW from '@astryxdesign/core/locales/zh-TW.json';
import fr from '@astryxdesign/core/locales/fr-FR.json';
import es from '@astryxdesign/core/locales/es-ES.json';
import ru from '@astryxdesign/core/locales/ru-RU.json';
import { getUiMessage } from '../lib/i18n';
import type { UiLocale } from '../lib/types';

const LocaleContext = createContext<UiLocale>('en');
const controlMessages = { 'zh-CN': zhCN, 'zh-TW': zhTW, fr, es, ru };
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
  return (
    <LocaleContext value={locale}>
      <InternationalizationProvider locale={locale} messages={controlMessages}>
        {children}
      </InternationalizationProvider>
    </LocaleContext>
  );
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
