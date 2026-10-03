import { statusTranslationQueued as enQueued, statusTranslating as enActive, statusTranslationRetrying as enRetry } from '../../public/_locales/en/messages.json';
import { statusTranslationQueued as cnQueued, statusTranslating as cnActive, statusTranslationRetrying as cnRetry } from '../../public/_locales/zh_CN/messages.json';
import { statusTranslationQueued as twQueued, statusTranslating as twActive, statusTranslationRetrying as twRetry } from '../../public/_locales/zh_TW/messages.json';
import { statusTranslationQueued as ruQueued, statusTranslating as ruActive, statusTranslationRetrying as ruRetry } from '../../public/_locales/ru/messages.json';
import { statusTranslationQueued as esQueued, statusTranslating as esActive, statusTranslationRetrying as esRetry } from '../../public/_locales/es/messages.json';
import { statusTranslationQueued as frQueued, statusTranslating as frActive, statusTranslationRetrying as frRetry } from '../../public/_locales/fr/messages.json';
import { catalogLocale } from './index';

export type LoadingPhase = 'queued' | 'translating' | 'retrying';

// Content scripts cannot fetch private extension catalogs from the page.
// Bundle only these three messages per locale from the existing catalog source.
const messages = {
  en: { queued: enQueued, translating: enActive, retrying: enRetry },
  'zh-CN': { queued: cnQueued, translating: cnActive, retrying: cnRetry },
  'zh-TW': { queued: twQueued, translating: twActive, retrying: twRetry },
  ru: { queued: ruQueued, translating: ruActive, retrying: ruRetry },
  es: { queued: esQueued, translating: esActive, retrying: esRetry },
  fr: { queued: frQueued, translating: frActive, retrying: frRetry },
};

export function getLoadingMessage(phase: LoadingPhase, uiLocale: string): string {
  return messages[catalogLocale(uiLocale)][phase].message;
}
