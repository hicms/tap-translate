import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Input, Select, Textarea, focusField } from '../../ui/fields';
import { EditorTabs } from '../../ui/editor-tabs';
import { languageKey, useLocale } from '../../ui/locale';
import { SUPPORTED_TARGET_LANGS } from '../../lib/settings/schema';
import type { SiteProfile } from '../../lib/sites/types';
import { resolveSiteProfile, siteProfiles } from '../../lib/sites';
import { resolveContentPolicy } from '../../lib/sites/policy';
import { checkCurrentPage } from './site-content-check';
import { contentErrorMessage, DraftError, newSite, readSiteContent, type SiteDraft } from './draft';

function ContentEditor({
  site,
  profiles,
  onChange,
  error,
}: {
  site: SiteDraft;
  profiles: readonly SiteProfile[];
  onChange: (value: SiteDraft) => void;
  error: DraftError | null;
}) {
  const { t } = useLocale();
  const profile = resolveSiteProfile(site.host, profiles) ?? null;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState({ snapshot: '', text: '', error: '' });
  const signature = JSON.stringify(site);
  const latest = useRef(signature);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = signature;
  }, [signature]);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  let effective = '';
  try {
    const policy = resolveContentPolicy(site.host, readSiteContent(site, t, false), profile);
    const content =
      policy.content.mode === 'generic'
        ? t('contentGeneric')
        : policy.content.mode === 'none'
          ? t('contentEmpty')
          : policy.content.selectors.join('\n');
    effective = `${t('contentSelectors')}\n${content}\n\n${t('ignoreSelectors')}\n${policy.ignore.join('\n') || t('ignoreEmpty')}`;
  } catch {
    /* Incomplete host drafts are validated by Save / Check. */
  }
  async function check() {
    setChecking(true);
    try {
      const draft = readSiteContent(site, t);
      const response = await checkCurrentPage(draft, profile);
      if (!mounted.current || latest.current !== signature) return;
      const counts = [
        ...response.content.map((item) => `${t('contentSelectors')}: ${item.selector} — ${item.count}`),
        ...response.ignore.map((item) => `${t('ignoreSelectors')}: ${item.selector} — ${item.count}`),
      ].join('\n');
      setResult({
        snapshot: signature,
        text: `${t('contentCheckResult', [response.host])}\n${counts || t(response.mode === 'none' ? 'contentEmpty' : 'contentGeneric')}`,
        error: '',
      });
    } catch (failure) {
      if (!mounted.current || latest.current !== signature) return;
      setResult({
        snapshot: signature,
        text: '',
        error:
          failure instanceof Error && failure.message.startsWith('CHECK_')
            ? t(failure.message)
            : contentErrorMessage(failure, t),
      });
    } finally {
      if (mounted.current) setChecking(false);
    }
  }
  return (
    <div className="content-editor">
      <div className="actions-inline">
        <Button
          label={t('contentResetAll')}
          onClick={() => onChange({ ...site, content: undefined, ignore: undefined })}
        />
        <Button
          label={t('contentCheck')}
          isDisabled={checking}
          onClick={() => {
            void check();
          }}
        />
      </div>
      <p className="content-error" role="alert">
        {error?.location.siteId === site.id
          ? error.message
          : result.snapshot === signature
            ? result.error
            : ''}
      </p>
      <div className="content-check-results" aria-live="polite">
        {result.snapshot === signature ? result.text : ''}
      </div>
      <p className="hint">{t('contentHelp')}</p>
      {(['content', 'ignore'] as const).map((field) => (
        <div key={field} className="content-field">
          <Select
            label={`${t(field === 'content' ? 'contentSelectors' : 'ignoreSelectors')}: ${t('contentSource')}`}
            data-rule-mode={field}
            value={site[field] === undefined ? 'inherit' : 'custom'}
            onChange={(value) =>
              onChange({
                ...site,
                [field]: value === 'inherit' ? undefined : (profile?.[field].join('\n') ?? ''),
              })
            }
            options={[
              {
                value: 'inherit',
                label: t(profile ? 'contentInheritBuiltin' : 'contentInheritGeneric'),
              },
              { value: 'custom', label: t('contentCustom') },
            ]}
          />
          <Textarea
            id={`site-${site.id}-${field}`}
            data-selectors={field}
            label={t(field === 'content' ? 'contentSelectors' : 'ignoreSelectors')}
            value={site[field] ?? profile?.[field].join('\n') ?? ''}
            disabled={site[field] === undefined}
            rows={3}
            spellCheck={false}
            aria-invalid={
              error?.location.siteId === site.id && error.location.field === field ? true : undefined
            }
            onChange={(value) => onChange({ ...site, [field]: value })}
          />
          <div className="content-field-caption">
            <p className="hint">{t(field === 'content' ? 'contentEmptyHint' : 'ignoreEmptyHint')}</p>
            <Button
              size="sm"
              variant="ghost"
              label={t('contentResetField')}
              onClick={() => onChange({ ...site, [field]: undefined })}
            />
          </div>
        </div>
      ))}
      <details>
        <summary>{t('contentEffective')}</summary>
        <pre className="content-effective" aria-label={t('contentEffective')}>
          {effective}
        </pre>
        <p className="hint">{t('contentProtections')}</p>
      </details>
      <p className="hint">{t('contentCheckHelp')}</p>
    </div>
  );
}

export function SiteWorkspace({
  sites,
  profiles = siteProfiles,
  onChange,
  selectedId,
  onSelect,
  tabs,
  onTab,
  editing,
  setEditing,
  error,
}: {
  sites: SiteDraft[];
  profiles?: readonly SiteProfile[];
  onChange: (sites: SiteDraft[]) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  tabs: Record<string, string>;
  onTab: (id: string, tab: string) => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
  error: DraftError | null;
}) {
  const { t } = useLocale();
  const [search, setSearch] = useState('');
  const selected = sites.find((site) => site.id === selectedId);
  const query = search.trim().toLowerCase();
  const groups = [
    ...profiles.map((profile) => ({
      name: profile.hosts[0]!,
      hosts: profile.hosts,
      builtin: true,
      site:
        sites.find((site) => site.builtin && site.id === selectedId && profile.hosts.includes(site.host)) ??
        sites.find((site) => site.host === profile.hosts[0])!,
    })),
    ...sites
      .filter((site) => !site.builtin)
      .map((site) => ({
        name: site.host || t('workspaceNewSite'),
        hosts: [site.host],
        builtin: false,
        site,
      })),
  ].filter((group) => group.hosts.join(' ').toLowerCase().includes(query));
  const update = (value: SiteDraft) => onChange(sites.map((site) => (site.id === value.id ? value : site)));
  const select = (id: string) => {
    onSelect(id);
    setEditing(true);
  };
  return (
    <>
      <div className="section-head section-head-row">
        <div>
          <h2 id="section-sites-title">{t('sectionSites')}</h2>
          <p className="hint">{t('workspaceSitesHint')}</p>
        </div>
        <Button
          id="addSiteRuleBtn"
          label={t('addSiteRule')}
          onClick={() => {
            const site = newSite();
            onChange([...sites, site]);
            select(site.id);
            requestAnimationFrame(() => focusField(`site-${site.id}-host`));
          }}
        />
      </div>
      <div id="siteWorkspace" className={`settings-workspace ${editing ? 'is-editing' : ''}`}>
        <aside className="workspace-sidebar">
          <div className="workspace-search">
            <Input
              id="siteSearch"
              type="search"
              label={t('workspaceSearchSites')}
              hideLabel
              placeholder={t('workspaceSearchSites')}
              value={search}
              onChange={(value) => setSearch(value)}
            />
          </div>
          <div id="siteList" className="workspace-list" aria-label={t('sectionSites')}>
            {[true, false].map((builtin) => (
              <div key={String(builtin)}>
                {groups.some((group) => group.builtin === builtin) ? (
                  <h3 className="workspace-group">
                    {t(builtin ? 'contentBuiltinSites' : 'contentCustomSites')}
                  </h3>
                ) : null}
                {groups
                  .filter((group) => group.builtin === builtin)
                  .map((group) => (
                    <Button
                      key={group.site.id}
                      variant="ghost"
                      className="workspace-item"
                      label={group.name}
                      data-site-host={group.hosts[0]}
                      aria-pressed={group.site.id === selectedId}
                      onClick={() => select(group.site.id)}
                    >
                      <span className="service-item-copy">
                        <strong>{group.name}</strong>
                        <small>
                          {group.hosts.length > 1
                            ? t('workspaceHostCount', [group.hosts.length])
                            : t(builtin ? 'contentBuiltinSites' : 'contentCustomSites')}
                        </small>
                      </span>
                    </Button>
                  ))}
              </div>
            ))}
            {groups.length === 0 ? <p className="empty-state">{t('workspaceNoMatches')}</p> : null}
          </div>
        </aside>
        <div id="siteRuleRows" className="site-cards">
          {sites.map((site) => {
            const profile = site.builtin ? resolveSiteProfile(site.host, profiles) : undefined;
            const tab = tabs[site.id] ?? 'preferences';
            return (
              <article
                key={site.id}
                className="site-card"
                data-site-id={site.id}
                data-host={site.host}
                data-builtin={profile ? 'true' : undefined}
                hidden={site.id !== selectedId}
              >
                <header className="site-card-head">
                  <Button
                    className="workspace-back"
                    variant="ghost"
                    label={t('workspaceBackSites')}
                    onClick={() => {
                      setEditing(false);
                      requestAnimationFrame(() =>
                        document.querySelector<HTMLButtonElement>('#siteList [aria-pressed="true"]')?.focus(),
                      );
                    }}
                  />
                  {profile ? (
                    <>
                      <Select
                        id={`site-${site.id}-host`}
                        className="site-domain-select"
                        label={t('siteHost')}
                        value={site.host}
                        onChange={(value) => {
                          const next = sites.find((item) => item.host === value)!;
                          onTab(next.id, tab);
                          select(next.id);
                          requestAnimationFrame(() => focusField(`site-${next.id}-host`));
                        }}
                        options={[
                          ...profile.hosts.map((host) => ({
                            value: host,
                            label: host,
                          })),
                        ]}
                      />
                    </>
                  ) : (
                    <Input
                      id={`site-${site.id}-host`}
                      data-field="host"
                      label={t('siteHost')}
                      value={site.host}
                      placeholder="example.com"
                      autoComplete="off"
                      aria-invalid={
                        error?.location.siteId === site.id && error.location.field === 'host'
                          ? true
                          : undefined
                      }
                      onChange={(value) => update({ ...site, host: value })}
                    />
                  )}
                  <p className="hint">{t('siteHostHint')}</p>
                  {!profile ? (
                    <Button
                      className="site-remove"
                      data-action="remove-site"
                      variant="ghost"
                      size="sm"
                      label={t('removeSite')}
                      onClick={() => {
                        onChange(sites.filter((item) => item.id !== site.id));
                        onSelect(sites.find((item) => item.id !== site.id)?.id ?? '');
                      }}
                    />
                  ) : null}
                </header>
                <EditorTabs
                  tabs={[
                    { id: 'preferences', label: t('workspacePreferences') },
                    { id: 'content', label: t('contentRules') },
                  ]}
                  value={tab}
                  onChange={(next) => onTab(site.id, next)}
                />
                <div className="workspace-editor-body">
                  <section
                    data-editor-panel="preferences"
                    hidden={tab !== 'preferences'}
                    aria-label={t('workspacePreferences')}
                  >
                    <div className="field-grid">
                      <Select
                        label={t('sitePolicy')}
                        data-field="policy"
                        value={site.policy}
                        onChange={(value) =>
                          update({
                            ...site,
                            policy: value as SiteDraft['policy'],
                          })
                        }
                        options={[
                          { value: 'global', label: t('sitePolicyGlobal') },
                          { value: 'auto', label: t('sitePolicyAuto') },
                          { value: 'never', label: t('sitePolicyNever') },
                        ]}
                      />
                      <Select
                        label={t('translationMode')}
                        data-field="mode"
                        value={site.mode}
                        disabled={site.policy === 'never'}
                        onChange={(value) => update({ ...site, mode: value as SiteDraft['mode'] })}
                        options={[
                          { value: '', label: t('siteUseGlobal') },
                          { value: 'bilingual', label: t('modeBilingual') },
                          { value: 'replace', label: t('modeReplace') },
                        ]}
                      />
                      <Select
                        label={t('targetLanguage')}
                        data-field="targetLang"
                        value={site.targetLang}
                        disabled={site.policy === 'never'}
                        onChange={(value) =>
                          update({
                            ...site,
                            targetLang: value as SiteDraft['targetLang'],
                          })
                        }
                        options={[
                          { value: '', label: t('siteUseGlobal') },
                          ...SUPPORTED_TARGET_LANGS.map((code) => ({
                            value: code,
                            label: t(languageKey(code)),
                          })),
                        ]}
                      />
                    </div>
                  </section>
                  <section
                    data-editor-panel="content"
                    hidden={tab !== 'content'}
                    aria-label={t('contentRules')}
                  >
                    <ContentEditor profiles={profiles} site={site} onChange={update} error={error} />
                  </section>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <p id="siteRulesEmpty" className="empty-state" hidden={Boolean(selected)}>
        {t('siteRulesEmpty')}
      </p>
    </>
  );
}
