import { useContext, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Check, Input, Select, FormDisabled, focusField } from '../../ui/fields';
import { Dialog } from '../../ui/dialog';
import { EditorTabs } from '../../ui/editor-tabs';
import { ProviderPicker } from '../../ui/provider-picker';
import { useLocale } from '../../ui/locale';
import { findProviderPreset, getProviderPreset, type ProviderPresetId } from '../../lib/provider/presets';
import { defaultModelParameters } from '../../lib/settings/model-parameters';
import { DEFAULT_MODEL_SCHEDULING } from '../../lib/settings/schema';
import { modelDraft, providerDraft, type ModelDraft, type OptionsDraft, type ProviderDraft } from './draft';
import { ModelParametersEditor } from './model-parameters';

export type ServiceSelection = { providerId: string; modelId: string };
export function ServiceWorkspace({
  draft,
  selection,
  onChange,
  onSelect,
  tab,
  setTab,
  editing,
  setEditing,
  onTest,
  testStatus,
  testing,
}: {
  draft: OptionsDraft;
  selection: ServiceSelection;
  onChange: (providers: ProviderDraft[], activeProviderId: string) => void;
  onSelect: (selection: ServiceSelection, activate?: boolean) => void;
  tab: string;
  setTab: (tab: string) => void;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  onTest: () => void;
  testStatus: { text: string; error: boolean };
  testing: boolean;
}) {
  const { t } = useLocale();
  const [adding, setAdding] = useState(false);
  const [candidate, setCandidate] = useState<ProviderPresetId>('local-api');
  const locked = useContext(FormDisabled);
  const provider = draft.providers.find((item) => item.id === selection.providerId)!;
  const model = provider.models.find((item) => item.id === selection.modelId)!;
  const update = (next: ProviderDraft) =>
    onChange(
      draft.providers.map((item) => (item.id === next.id ? next : item)),
      draft.activeProviderId,
    );
  const changeModel = (next: ModelDraft) =>
    update({
      ...provider,
      models: provider.models.map((item) => (item.id === next.id ? next : item)),
    });
  const focus = (id: string) => requestAnimationFrame(() => focusField(id));
  function addProvider(id: ProviderPresetId) {
    const preset = getProviderPreset(id);
    const modelId = crypto.randomUUID();
    const next = providerDraft({
      id: crypto.randomUUID(),
      name: t(preset.labelKey),
      connectionMode: preset.mode,
      apiBase: preset.apiBase || 'https://api.example.com/v1',
      apiKey: '',
      persistApiKey: true,
      customHeaders: {},
      activeModelId: modelId,
      models: [
        {
          id: modelId,
          name: preset.model || 'my-model',
          parameters: defaultModelParameters(),
          ...DEFAULT_MODEL_SCHEDULING,
        },
      ],
    });
    onChange([...draft.providers, next], next.id);
    onSelect({ providerId: next.id, modelId }, false);
    setAdding(false);
    setEditing(true);
    setTab(id === 'custom' ? 'advanced' : 'basic');
    focus(id === 'custom' ? 'apiBase' : 'apiKey');
  }
  function addModel() {
    const next = modelDraft({
      id: crypto.randomUUID(),
      name: 'new-model',
      parameters: defaultModelParameters(),
      ...DEFAULT_MODEL_SCHEDULING,
    });
    onChange(
      draft.providers.map((item) =>
        item.id === provider.id
          ? {
              ...provider,
              models: [...provider.models, next],
              activeModelId: next.id,
            }
          : item,
      ),
      provider.id,
    );
    onSelect({ providerId: provider.id, modelId: next.id }, false);
    setTab('basic');
    focus('model');
  }
  function removeProvider() {
    const next = draft.providers.filter((item) => item.id !== provider.id);
    const activeId = draft.activeProviderId === provider.id ? next[0]!.id : draft.activeProviderId;
    const active = next.find((item) => item.id === activeId)!;
    onChange(next, activeId);
    onSelect({ providerId: active.id, modelId: active.activeModelId }, false);
  }
  function removeModel() {
    const models = provider.models.filter((item) => item.id !== model.id);
    const activeModelId = provider.activeModelId === model.id ? models[0]!.id : provider.activeModelId;
    update({ ...provider, models, activeModelId });
    onSelect({ providerId: provider.id, modelId: activeModelId }, false);
  }
  return (
    <>
      <div className="section-head section-head-row">
        <div>
          <h2 id="section-connection-title">{t('translationServices')}</h2>
          <p className="hint">{t('minimalServicesHint')}</p>
        </div>
        <Button
          id="addProviderBtn"
          label={t('addProvider')}
          onClick={() => {
            setCandidate('local-api');
            setAdding(true);
          }}
        />
      </div>
      <div id="serviceWorkspace" className={`settings-workspace ${editing ? 'is-editing' : ''}`}>
        <aside className="workspace-sidebar">
          <div className="workspace-list-title">{t('currentModel')}</div>
          <div id="serviceList" className="workspace-list" aria-label={t('translationServices')}>
            {draft.providers.map((item) => (
              <div key={item.id}>
                <h3 className="workspace-group">{item.name || t('newProvider')}</h3>
                {item.models.map((entry) => (
                  <Button
                    key={entry.id}
                    variant="ghost"
                    className="workspace-item service-list-item"
                    label={entry.name || t('newModel')}
                    data-service-model={JSON.stringify([item.id, entry.id])}
                    aria-pressed={item.id === provider.id && entry.id === model.id}
                    onClick={() => {
                      onSelect({ providerId: item.id, modelId: entry.id });
                      setEditing(true);
                    }}
                  >
                    <img src={findProviderPreset(item.apiBase).iconPath} alt="" />
                    <span className="service-item-copy">
                      <strong>{entry.name || t('newModel')}</strong>
                      <small>
                        {item.id === draft.activeProviderId && entry.id === item.activeModelId
                          ? t('currentModel')
                          : item.name}
                      </small>
                    </span>
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </aside>
        <div id="serviceEditor" className="service-editor">
          <header className="workspace-editor-head">
            <Button
              className="workspace-back"
              variant="ghost"
              label={t('workspaceBackServices')}
              onClick={() => {
                setEditing(false);
                requestAnimationFrame(() =>
                  document.querySelector<HTMLButtonElement>('#serviceList [aria-pressed="true"]')?.focus(),
                );
              }}
            />
            <div className="section-head-row">
              <h3 id="serviceEditorTitle">
                {provider.name || t('newProvider')} · {model.name || t('newModel')}
              </h3>
              <Button id="addModelBtn" variant="ghost" label={t('addModel')} onClick={addModel} />
            </div>
            <div className="service-model-picker">
              <img id="currentProviderIcon" src={findProviderPreset(provider.apiBase).iconPath} alt="" />
              <Select
                id="currentModel"
                hideLabel
                label={t('currentModel')}
                value={JSON.stringify([provider.id, model.id])}
                onChange={(value) => {
                  const [providerId, modelId] = JSON.parse(value) as [string, string];
                  onSelect({ providerId, modelId });
                }}
                options={[
                  ...draft.providers.map((item) => ({
                    type: 'section' as const,
                    title: item.name,
                    options: [
                      ...item.models.map((entry) => ({
                        value: JSON.stringify([item.id, entry.id]),
                        label: item.name + '·' + entry.name,
                      })),
                    ],
                  })),
                ]}
              />
            </div>
          </header>
          <EditorTabs
            tabs={[
              { id: 'basic', label: t('workspaceBasicSettings') },
              { id: 'advanced', label: t('modelAdvanced') },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="workspace-editor-body">
            <section
              data-editor-panel="basic"
              hidden={tab !== 'basic'}
              aria-label={t('workspaceBasicSettings')}
            >
              <Input
                id="apiKey"
                label={t('apiKey')}
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                value={provider.apiKey}
                onChange={(value) => update({ ...provider, apiKey: value })}
              />
              <p id="apiKeyHint" className="hint" hidden={provider.connectionMode !== 'proxy'}>
                {t('apiKeyProxyHint')}
              </p>
              <Input
                id="model"
                label={t('model')}
                required
                maxLength={200}
                value={model.name}
                onChange={(value) => changeModel({ ...model, name: value })}
              />
            </section>
            <section
              id="modelAdvanced"
              data-editor-panel="advanced"
              hidden={tab !== 'advanced'}
              aria-label={t('modelAdvanced')}
            >
              <div className="field-grid">
                <Input
                  id="providerName"
                  label={t('providerName')}
                  required
                  maxLength={100}
                  value={provider.name}
                  onChange={(value) => update({ ...provider, name: value })}
                />
                <Select
                  id="connectionMode"
                  label={t('connectionMode')}
                  value={provider.connectionMode}
                  onChange={(value) =>
                    update({
                      ...provider,
                      connectionMode: value as ProviderDraft['connectionMode'],
                    })
                  }
                  options={[
                    { value: 'direct', label: t('directApi') },
                    { value: 'proxy', label: t('connectionModeProxy') },
                  ]}
                />
              </div>
              <Input
                id="apiBase"
                label={t('apiBaseUrl')}
                type="url"
                required
                value={provider.apiBase}
                onChange={(value) => update({ ...provider, apiBase: value })}
              />
              <Check
                id="rememberApiKey"
                label={t('rememberApiKey')}
                checked={provider.persistApiKey}
                onChange={(persistApiKey) => update({ ...provider, persistApiKey })}
                hint={t('rememberApiKeyHint')}
              />
              <details id="advancedConnection" className="advanced">
                <summary>{t('customHeadersTitle')}</summary>
                <p className="hint">{t('customHeadersHint')}</p>
                <Button
                  id="addHeaderBtn"
                  label={t('addHeader')}
                  onClick={() => {
                    const header = {
                      id: crypto.randomUUID(),
                      name: '',
                      value: '',
                    };
                    update({
                      ...provider,
                      headers: [...provider.headers, header],
                    });
                    focus(`header-${header.id}`);
                  }}
                />
                <div id="customHeaderRows">
                  {provider.headers.map((row) => (
                    <div key={row.id} className="header-row">
                      <Input
                        id={`header-${row.id}`}
                        data-field="name"
                        label={t('headerName')}
                        value={row.name}
                        autoComplete="off"
                        onChange={(value) =>
                          update({
                            ...provider,
                            headers: provider.headers.map((item) =>
                              item.id === row.id ? { ...item, name: value } : item,
                            ),
                          })
                        }
                      />
                      <Input
                        data-field="value"
                        label={t('headerValue')}
                        value={row.value}
                        autoComplete="off"
                        onChange={(value) =>
                          update({
                            ...provider,
                            headers: provider.headers.map((item) =>
                              item.id === row.id ? { ...item, value: value } : item,
                            ),
                          })
                        }
                      />
                      <Button
                        data-action="remove-header"
                        aria-label={t('removeHeader')}
                        variant="ghost"
                        label={t('removeHeader')}
                        onClick={() =>
                          update({
                            ...provider,
                            headers: provider.headers.filter((item) => item.id !== row.id),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <p id="customHeadersEmpty" className="hint" hidden={provider.headers.length > 0}>
                  {t('customHeadersEmpty')}
                </p>
              </details>
              <ModelParametersEditor model={model} provider={provider} onChange={changeModel} />
              <div className="actions service-delete-actions">
                <Button
                  id="removeModelBtn"
                  label={t('removeModel')}
                  isDisabled={provider.models.length < 2}
                  onClick={removeModel}
                />
                <Button
                  id="removeProviderBtn"
                  label={t('removeProvider')}
                  isDisabled={draft.providers.length < 2}
                  onClick={removeProvider}
                />
              </div>
            </section>
          </div>
          <div className="connection-test-control">
            <Button
              id="testConnectionBtn"
              label={t('testConnection')}
              isDisabled={testing}
              onClick={onTest}
            />
            <span
              id="testConnectionStatus"
              role="status"
              className={`save-status ${testStatus.error ? 'is-error' : ''}`}
            >
              {testStatus.text}
            </span>
          </div>
        </div>
      </div>
      <Dialog
        id="addProviderDialog"
        title={t('addProviderTitle')}
        open={adding}
        onClose={() => setAdding(false)}
      >
        <p className="hint">{t('addProviderHint')}</p>
        <ProviderPicker inline selected={candidate} onSelect={setCandidate} />
        <div className="actions">
          <Button
            id="closeProviderDialogBtn"
            variant="ghost"
            label={t('close')}
            isDisabled={locked}
            onClick={() => setAdding(false)}
          />
          <Button
            id="confirmProviderBtn"
            variant="primary"
            label={t('addProvider')}
            isDisabled={locked}
            onClick={() => addProvider(candidate)}
          />
        </div>
      </Dialog>
    </>
  );
}
