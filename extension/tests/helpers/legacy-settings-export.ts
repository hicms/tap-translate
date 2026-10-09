import type { Settings } from '../../lib/types';

export interface SettingsExportOptions {
  includeApiKey: boolean;
  includeCustomHeaders: boolean;
}

/** Fixture builder for JSON files produced by the removed legacy exporter. */
export function buildSettingsExport(
  settings: Settings,
  options: SettingsExportOptions,
): Partial<Settings> {
  const output: Partial<Settings> = { ...settings };
  if (!options.includeApiKey) delete output.apiKey;
  if (!options.includeCustomHeaders) delete output.customHeaders;
  output.providers = settings.providers.map((provider) => {
    const copy = { ...provider };
    if (!options.includeApiKey) Reflect.deleteProperty(copy, 'apiKey');
    if (!options.includeCustomHeaders) Reflect.deleteProperty(copy, 'customHeaders');
    return copy;
  });
  return output;
}
