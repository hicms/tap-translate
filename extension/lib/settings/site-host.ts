export type SettingsValidationCode =
  | 'API_BASE_REQUIRED'
  | 'API_BASE_INVALID'
  | 'API_BASE_INSECURE'
  | 'SITE_HOST_REQUIRED'
  | 'SITE_HOST_INVALID'
  | 'SITE_HOST_DUPLICATE';

export class SettingsValidationError extends Error {
  constructor(readonly code: SettingsValidationCode) {
    super(code);
    this.name = 'SettingsValidationError';
  }
}

export function validationCodeOf(error: unknown): SettingsValidationCode | null {
  return error instanceof SettingsValidationError ? error.code : null;
}

/**
 * A site rule applies to one exact hostname. URLs are accepted for convenience,
 * but paths, ports and wildcards are deliberately rejected rather than silently
 * creating a rule that can never match.
 */
export function normalizeSiteHost(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) throw new SettingsValidationError('SITE_HOST_REQUIRED');
  if (value.includes('*')) throw new SettingsValidationError('SITE_HOST_INVALID');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new SettingsValidationError('SITE_HOST_INVALID');
  }
  if (
    !url.hostname
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname && url.pathname !== '/')
  ) {
    throw new SettingsValidationError('SITE_HOST_INVALID');
  }
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

