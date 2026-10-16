/** Whitespace and invisible formatting characters alone are not a translation. */
export function hasTranslationText(value: unknown): value is string {
  return typeof value === 'string'
    && value.replace(/[\s\u200B-\u200F\u202A-\u202E\u2060-\u206F]/gu, '').length > 0;
}
