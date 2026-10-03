import { Button } from '@astryxdesign/core/Button';
import { Input, Select, Textarea } from '../../ui/fields';
import { useLocale } from '../../ui/locale';
import { defaultModelParameters } from '../../lib/settings/model-parameters';
import { DEFAULT_MODEL_SCHEDULING } from '../../lib/settings/schema';
import { resolveThinking } from '../../lib/provider/thinking';
import { modelDraft, numericParameters, readModel, type ModelDraft, type ProviderDraft } from './draft';

export function ModelParametersEditor({
  model,
  provider,
  onChange,
}: {
  model: ModelDraft;
  provider: ProviderDraft;
  onChange: (model: ModelDraft) => void;
}) {
  const { t } = useLocale();
  function parameter<K extends keyof ModelDraft['parameters']>(key: K, value: ModelDraft['parameters'][K]) {
    onChange({ ...model, parameters: { ...model.parameters, [key]: value } });
  }
  let jsonIssue = '';
  let parameters = defaultModelParameters();
  try {
    parameters = readModel(model, provider.id, t).parameters;
  } catch (error) {
    jsonIssue = error instanceof Error ? error.message : String(error);
  }
  const resolution = resolveThinking({
    apiBase: provider.apiBase,
    model: model.name,
    modelParameters: parameters,
  });
  const issue = jsonIssue || (resolution.issue ? t(resolution.issue) : '');
  const labels = {
    temperature: 'Temperature',
    maxTokens: t('maxTokens'),
    topP: 'Top P',
    frequencyPenalty: t('frequencyPenalty'),
    presencePenalty: t('presencePenalty'),
  };
  return (
    <div className="model-settings">
      <h3>{t('modelParameters')}</h3>
      <p className="hint">{t('modelParametersHint')}</p>
      <div className="field-grid parameter-grid">
        {numericParameters.map((key) => (
          <Input
            key={key}
            id={key}
            type="number"
            label={labels[key]}
            required={key !== 'maxTokens'}
            value={model.parameters[key]}
            placeholder={key === 'maxTokens' ? t('automatic') : undefined}
            hint={
              key === 'temperature'
                ? t('temperatureHint')
                : key === 'maxTokens'
                  ? t('maxTokensHint')
                  : undefined
            }
            onChange={(value) => parameter(key, value)}
          />
        ))}
        <Select
          id="reasoningEffort"
          label={t('reasoningEffort')}
          value={model.parameters.reasoningEffort}
          disabled={
            model.customThinking ||
            !resolution.profile.efforts.length ||
            model.parameters.thinking === 'disabled' ||
            (model.parameters.thinking === 'auto' && resolution.profile.automatic === 'disabled')
          }
          onChange={(value) =>
            parameter('reasoningEffort', value as ModelDraft['parameters']['reasoningEffort'])
          }
          options={[
            ...(['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((value) => ({
              value: value,
              label: t(value === 'auto' ? 'automatic' : `effort${value[0]!.toUpperCase()}${value.slice(1)}`),
              disabled: value !== 'auto' && !resolution.profile.efforts.some((effort) => effort === value),
            })),
          ]}
        />
        <Select
          id="thinking"
          label={t('thinkingMode')}
          value={model.parameters.thinking}
          onChange={(value) => parameter('thinking', value as ModelDraft['parameters']['thinking'])}
          aria-describedby="thinkingHint thinkingError"
          options={[
            { value: 'auto', label: t('automatic') },
            {
              value: 'enabled',
              label: t('enabled'),
              disabled: resolution.profile.enabled === null,
            },
            {
              value: 'disabled',
              label: t('disabled'),
              disabled: resolution.profile.disabled === null,
            },
          ]}
        />
        <Select
          id="tokenLimitField"
          label={t('tokenLimitField')}
          value={model.parameters.tokenLimitField}
          onChange={(value) =>
            parameter('tokenLimitField', value as ModelDraft['parameters']['tokenLimitField'])
          }
          options={[
            { value: 'auto', label: t('automatic') },
            { value: 'max_tokens', label: 'max_tokens' },
            { value: 'max_completion_tokens', label: 'max_completion_tokens' },
          ]}
        />
        <Input
          id="maxConcurrent"
          type="number"
          required
          label={t('maxConcurrent')}
          hint={t('maxConcurrentHint')}
          value={model.maxConcurrent}
          onChange={(value) => onChange({ ...model, maxConcurrent: value })}
        />
        <Input
          id="batchSize"
          type="number"
          required
          label={t('batchSize')}
          hint={t('batchSizeHint')}
          value={model.batchSize}
          onChange={(value) => onChange({ ...model, batchSize: value })}
        />
      </div>
      <div className="thinking-settings">
        <p className="hint" id="thinkingHint" aria-live="polite">
          {t(resolution.profile.hintKey)}
        </p>
        <p id="thinkingError" className="thinking-error" role="alert" hidden={!issue}>
          {issue}
        </p>
        <Select
          id="thinkingAdapter"
          label={t('thinkingAdapter')}
          value={model.customThinking ? 'custom' : 'auto'}
          onChange={(value) => onChange({ ...model, customThinking: value === 'custom' })}
          options={[
            { value: 'auto', label: t('thinkingAdapterAuto') },
            { value: 'custom', label: t('thinkingAdapterCustom') },
          ]}
        />
        <div id="thinkingCustomFields" hidden={!model.customThinking}>
          <p className="hint">{t('thinkingCustomHelp')}</p>
          <div className="field-grid">
            <Textarea
              id="thinkingEnabledBody"
              label={t('thinkingEnabledBody')}
              rows={5}
              maxLength={4096}
              spellCheck={false}
              disabled={!model.customThinking}
              value={model.enabledBody}
              onChange={(value) => onChange({ ...model, enabledBody: value })}
            />
            <Textarea
              id="thinkingDisabledBody"
              label={t('thinkingDisabledBody')}
              rows={5}
              maxLength={4096}
              spellCheck={false}
              disabled={!model.customThinking}
              value={model.disabledBody}
              onChange={(value) => onChange({ ...model, disabledBody: value })}
            />
          </div>
        </div>
      </div>
      <Textarea
        id="systemPrompt"
        label={t('translationInstructions')}
        hint={t('translationInstructionsHint')}
        rows={4}
        maxLength={20000}
        placeholder={t('translationInstructionsPlaceholder')}
        value={model.parameters.systemPrompt}
        onChange={(value) => parameter('systemPrompt', value)}
      />
      <Button
        id="resetModelBtn"
        label={t('resetModelParameters')}
        onClick={() =>
          onChange(
            modelDraft({
              id: model.id,
              name: model.name,
              parameters: defaultModelParameters(),
              ...DEFAULT_MODEL_SCHEDULING,
            }),
          )
        }
      />
    </div>
  );
}
