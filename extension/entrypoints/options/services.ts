import type { ModelParameters, ProviderConfig, ProviderModel, Settings } from '../../lib/types';
import { activeProviderFields, DEFAULT_MODEL_SCHEDULING, providerConfigSchema } from '../../lib/settings/schema';
import { defaultModelParameters } from '../../lib/settings/model-parameters';
import { findProviderPreset, getProviderPreset } from '../../lib/provider/presets';
import { mountProviderPicker } from '../../lib/provider/picker';
import { revealSettingsElement, revealSettingsError } from './navigation';
import { mountThinkingEditor } from './thinking-editor';
import { mountEditorTabs } from './editor-tabs';

export interface ServiceEditor {
  load(settings: Settings): void;
  read(): Pick<Settings, 'providers' | 'activeProviderId'>;
  selectedConnection(): ReturnType<typeof activeProviderFields>;
  validate(): void;
  refreshLabels(): void;
}

const parameterIds = ['temperature', 'maxTokens', 'topP', 'frequencyPenalty', 'presencePenalty', 'reasoningEffort', 'thinking', 'tokenLimitField', 'systemPrompt'] as const;

export function mountServiceEditor(
  t: (key: string, subs?: (string | number)[]) => string,
  changed: () => void,
  renderHeaders: (headers: Record<string, string>) => void,
  readHeaders: () => Record<string, string>,
): ServiceEditor {
  let providers: ProviderConfig[] = [];
  let activeProviderId = '';
  let selectedProviderId = '';
  let selectedModelId = '';
  const control = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const selectedProvider = () => providers.find((provider) => provider.id === selectedProviderId)!;
  const selectedModel = () => selectedProvider().models.find((model) => model.id === selectedModelId)!;
  const list = document.getElementById('currentModel') as HTMLSelectElement;
  list.setAttribute('aria-label', t('currentModel')); list.dataset.i18nAriaLabel = 'currentModel';
  const workspace = document.getElementById('serviceWorkspace')!;
  const modelList = document.getElementById('serviceList')!;
  const editor = document.getElementById('serviceEditor')!;
  editor.append(editor.querySelector('.connection-test-control')!);
  editor.querySelector('.workspace-editor-body')!.before(mountEditorTabs(editor, [
    { id: 'basic', label: t('workspaceBasicSettings'), key: 'workspaceBasicSettings' },
    { id: 'advanced', label: t('modelAdvanced'), key: 'modelAdvanced' },
  ]));
  editor.addEventListener('settings-reveal', () => workspace.classList.add('is-editing'));
  editor.querySelector('.workspace-back')!.addEventListener('click', () => {
    workspace.classList.remove('is-editing');
    modelList.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  });
  const thinkingEditor = mountThinkingEditor(t, () => {
    refreshModelDraft();
    changed();
  });

  function refreshModelDraft(): void {
    try {
      capture();
      thinkingEditor.refresh(selectedProvider(), selectedModel());
      renderList();
    } catch {
      // An incomplete header draft is reported on Save/Test, without moving focus while typing.
    }
  }

  function capture(): void {
    if (!providers.length) return;
    const provider = selectedProvider();
    provider.name = control('providerName').value;
    provider.connectionMode = control('connectionMode').value as ProviderConfig['connectionMode'];
    provider.apiBase = control('apiBase').value.trim();
    provider.apiKey = control('apiKey').value.trim();
    provider.persistApiKey = (control('rememberApiKey') as HTMLInputElement).checked;
    provider.customHeaders = readHeaders();
    selectedModel().name = control('model').value.trim();
    selectedModel().maxConcurrent = Number(control('maxConcurrent').value);
    selectedModel().batchSize = Number(control('batchSize').value);
    const raw: Record<string, unknown> = {};
    for (const id of parameterIds) {
      const value = control(id).value;
      raw[id] = ['reasoningEffort', 'thinking', 'tokenLimitField', 'systemPrompt'].includes(id)
        ? value : Number(value);
    }
    selectedModel().parameters = { ...selectedModel().parameters, ...raw } as ModelParameters;
    thinkingEditor.capture(selectedModel());
  }

  function edit(action: () => void): void {
    try { action(); } catch (error) {
      (document.getElementById('addProviderDialog') as HTMLDialogElement).close();
      revealSettingsError();
      const status = document.getElementById('testConnectionStatus')!;
      status.textContent = t('serviceConfigurationInvalid', [error instanceof Error ? error.message : String(error)]);
      status.classList.add('is-error');
      renderList();
    }
  }

  function select(provider: ProviderConfig, model: ProviderModel): void {
    capture();
    selectedProviderId = activeProviderId = provider.id;
    selectedModelId = provider.activeModelId = model.id;
    workspace.classList.add('is-editing');
    fill(); renderList(); changed();
  }

  function renderList(): void {
    const scrollTop = modelList.scrollTop;
    list.replaceChildren();
    modelList.replaceChildren();
    for (const provider of providers) {
      const group = document.createElement('optgroup');
      group.label = provider.name || t('newProvider');
      const heading = document.createElement('h3'); heading.className = 'workspace-group'; heading.textContent = group.label;
      modelList.append(heading);
      for (const model of provider.models) {
        const option = document.createElement('option');
        option.value = JSON.stringify([provider.id, model.id]);
        option.textContent = `${group.label} · ${model.name || t('newModel')}`;
        option.selected = provider.id === selectedProviderId && model.id === selectedModelId;
        group.append(option);
        const item = document.createElement('button');
        item.type = 'button'; item.className = 'workspace-item service-list-item'; item.dataset.serviceModel = option.value;
        item.setAttribute('aria-pressed', String(option.selected));
        const icon = document.createElement('img'); icon.src = findProviderPreset(provider.apiBase).iconPath; icon.alt = '';
        const copy = document.createElement('span'); copy.className = 'service-item-copy';
        const name = document.createElement('strong'); name.textContent = model.name || t('newModel');
        const description = document.createElement('small'); description.textContent = option.selected ? t('currentModel') : group.label;
        copy.append(name, description); item.append(icon, copy);
        item.addEventListener('click', () => edit(() => {
          select(provider, model);
          const focus = matchMedia('(max-width: 700px)').matches ? editor.querySelector<HTMLButtonElement>('.workspace-back') : modelList.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
          focus?.focus({ preventScroll: true });
        }));
        modelList.append(item);
      }
      list.append(group);
    }
    modelList.scrollTop = scrollTop;
    document.getElementById('serviceEditorTitle')!.textContent = `${selectedProvider().name || t('newProvider')} · ${selectedModel().name || t('newModel')}`;
    (document.getElementById('currentProviderIcon') as HTMLImageElement).src = findProviderPreset(selectedProvider().apiBase).iconPath;
    button('removeProviderBtn').disabled = providers.length < 2;
    button('removeModelBtn').disabled = selectedProvider().models.length < 2;
  }

  list.addEventListener('change', () => edit(() => {
    const [providerId, modelId] = JSON.parse(list.value) as [string, string];
    const provider = providers.find((item) => item.id === providerId)!;
    select(provider, provider.models.find((model) => model.id === modelId)!);
  }));

  function fill(): void {
    const provider = selectedProvider();
    const model = selectedModel();
    for (const id of ['apiBase', 'apiKey', 'connectionMode'] as const) control(id).value = provider[id];
    control('providerName').value = provider.name;
    control('model').value = model.name;
    for (const id of ['maxConcurrent', 'batchSize'] as const) {
      control(id).value = String(model[id]);
    }
    (control('rememberApiKey') as HTMLInputElement).checked = provider.persistApiKey;
    for (const id of parameterIds) control(id).value = id === 'maxTokens' && !model.parameters.maxTokens ? '' : String(model.parameters[id]);
    thinkingEditor.fill(model);
    thinkingEditor.refresh(provider, model);
    renderHeaders(provider.customHeaders);
    updateKeyHint();
    document.getElementById('testConnectionStatus')!.textContent = '';
  }

  function updateKeyHint(): void {
    const hint = document.getElementById('apiKeyHint')!;
    hint.textContent = t(control('connectionMode').value === 'proxy' ? 'apiKeyProxyHint' : 'apiKeyDirectHint');
    hint.hidden = control('connectionMode').value !== 'proxy';
  }

  const picker = mountProviderPicker(document.getElementById('providerPicker')!, t, (id) => edit(() => {
    capture();
    const preset = getProviderPreset(id);
    const modelId = crypto.randomUUID();
    const provider: ProviderConfig = {
      id: crypto.randomUUID(), name: t(preset.labelKey), connectionMode: preset.mode,
      apiBase: preset.apiBase || 'https://api.example.com/v1', apiKey: '', persistApiKey: true,
      customHeaders: {}, activeModelId: modelId,
      models: [{ id: modelId, name: preset.model || 'my-model', parameters: defaultModelParameters(), ...DEFAULT_MODEL_SCHEDULING }],
    };
    providers.push(provider);
    selectedProviderId = activeProviderId = provider.id;
    selectedModelId = modelId;
    workspace.classList.add('is-editing');
    (document.getElementById('addProviderDialog') as HTMLDialogElement).close();
    fill();
    renderList();
    changed();
    if (id === 'custom') revealSettingsElement(control('apiBase'));
    else revealSettingsElement(control('apiKey'));
  }), { inline: true });
  picker.setSelected('custom');
  button('addProviderBtn').addEventListener('click', () => (document.getElementById('addProviderDialog') as HTMLDialogElement).showModal());
  button('closeProviderDialogBtn').addEventListener('click', () => (document.getElementById('addProviderDialog') as HTMLDialogElement).close());
  button('addModelBtn').addEventListener('click', () => edit(() => {
    capture();
    const model = { id: crypto.randomUUID(), name: 'new-model', parameters: defaultModelParameters(), ...DEFAULT_MODEL_SCHEDULING };
    selectedProvider().models.push(model);
    selectedModelId = selectedProvider().activeModelId = model.id;
    activeProviderId = selectedProviderId;
    fill(); renderList(); changed(); revealSettingsElement(control('model'));
    (control('model') as HTMLInputElement).select();
  }));
  button('removeProviderBtn').addEventListener('click', () => {
    if (providers.length < 2) return;
    providers = providers.filter((provider) => provider.id !== selectedProviderId);
    if (activeProviderId === selectedProviderId) activeProviderId = providers[0]!.id;
    selectedProviderId = activeProviderId;
    selectedModelId = selectedProvider().activeModelId;
    fill(); renderList(); changed();
  });
  button('removeModelBtn').addEventListener('click', () => edit(() => {
    const provider = selectedProvider();
    if (provider.models.length < 2) return;
    capture();
    provider.models = provider.models.filter((model) => model.id !== selectedModelId);
    if (provider.activeModelId === selectedModelId) provider.activeModelId = provider.models[0]!.id;
    selectedModelId = provider.activeModelId;
    fill(); renderList(); changed();
  }));
  button('resetModelBtn').addEventListener('click', () => edit(() => {
    capture();
    selectedModel().parameters = defaultModelParameters();
    thinkingEditor.reset(selectedModel());
    Object.assign(selectedModel(), DEFAULT_MODEL_SCHEDULING);
    fill(); changed();
  }));
  for (const id of ['providerName', 'model', 'apiBase']) {
    control(id).addEventListener('input', refreshModelDraft);
  }
  control('connectionMode').addEventListener('change', () => {
    updateKeyHint();
  });
  function revealThinkingError(): void {
    const invalid = document.querySelector<HTMLElement>('#thinkingCustomFields :invalid, #thinking:invalid');
    revealSettingsElement(invalid ?? control('thinking'));
  }

  return {
    load(settings) {
      thinkingEditor.clear();
      providers = structuredClone(settings.providers);
      activeProviderId = settings.activeProviderId;
      selectedProviderId = activeProviderId;
      selectedModelId = selectedProvider().activeModelId;
      fill(); renderList();
    },
    read() {
      capture();
      if (thinkingEditor.hasInvalidDraft(providers)) throw new Error(t('thinkingJsonInvalid'));
      return { providers: structuredClone(providers), activeProviderId };
    },
    selectedConnection() {
      capture();
      const provider = selectedProvider();
      const issue = thinkingEditor.issue(provider, selectedModel());
      if (issue) { revealThinkingError(); throw new Error(t(issue)); }
      return activeProviderFields([{ ...provider, activeModelId: selectedModelId }], selectedProviderId);
    },
    validate() {
      capture();
      for (const provider of providers) {
        for (const model of provider.models) {
          const issue = thinkingEditor.issue(provider, model);
          if (issue) {
            selectedProviderId = provider.id;
            selectedModelId = model.id;
            fill(); renderList();
            revealThinkingError();
            throw new Error(`${provider.name} / ${model.name}: ${t(issue)}`);
          }
        }
        const result = providerConfigSchema.safeParse(provider);
        if (!result.success) {
          selectedProviderId = provider.id;
          const modelIndex = result.error.issues[0]?.path[0] === 'models' ? Number(result.error.issues[0]?.path[1]) : 0;
          selectedModelId = provider.models[modelIndex]?.id ?? provider.models[0]!.id;
          fill(); renderList();
          const path = result.error.issues[0]?.path ?? [];
          const field = String(path[path.length - 1] ?? 'providerName');
          revealSettingsElement(control(field === 'name' ? (path[0] === 'models' ? 'model' : 'providerName') : field) || control('providerName'));
          throw new Error(`${provider.name}: ${result.error.issues[0]?.message}`);
        }
      }
    },
    refreshLabels() {
      picker.refreshLabels();
      if (providers.length) {
        thinkingEditor.capture(selectedModel());
        thinkingEditor.refresh(selectedProvider(), selectedModel());
        renderList();
        updateKeyHint();
      }
    },
  };
}
