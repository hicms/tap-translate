import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import type { ReactNode } from 'react';
import { ensureCatalogs } from '../lib/i18n';
import { getSettings } from '../lib/settings/storage';
import type { Settings } from '../lib/types';
import './style.css';

export async function mountPage(render: (settings: Settings) => ReactNode): Promise<void> {
  const root = createRoot(document.getElementById('root')!);
  try {
    const [, settings] = await Promise.all([ensureCatalogs(), getSettings()]);
    root.render(
      <Theme theme={neutralTheme} mode="system">
        {render(settings)}
      </Theme>,
    );
  } catch (error) {
    console.error('[TapTranslate] UI initialization failed', error);
    root.render(
      <main role="alert">TapTranslate: {error instanceof Error ? error.message : String(error)}</main>,
    );
  }
}
