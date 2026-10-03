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
  const constraints = {
    temperature: [0, 2],
    maxTokens: [1, 1000000],
    topP: [0, 1],
    frequencyPenalty: [-2, 2],
    presencePenalty: [-2, 2],
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
            min={constraints[key][0]}
            max={constraints[key][1]}
            step={key === 'maxTokens' ? 1 : 0.01}
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
            onChange={(event) => parameter(key, event.target.value)}
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
          onChange={(event) =>
            parameter('reasoningEffort', event.target.value as ModelDraft['parameters']['reasoningEffort'])
          }
        >
          {(['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((value) => (
            <option
              key={value}
              value={value}
              disabled={value !== 'auto' && !resolution.profile.efforts.some((effort) => effort === value)}
            >
              {t(value === 'auto' ? 'automatic' : `effort${value[0]!.toUpperCase()}${value.slice(1)}`)}
            </option>
          ))}
        </Select>
        <Select
          id="thinking"
          label={t('thinkingMode')}
          value={model.parameters.thinking}
          onChange={(event) =>
            parameter('thinking', event.target.value as ModelDraft['parameters']['thinking'])
          }
          aria-describedby="thinkingHint thinkingError"
        >
          <option value="auto">{t('automatic')}</option>
          <option value="enabled" disabled={resolution.profile.enabled === null}>
            {t('enabled')}
          </option>
          <option value="disabled" disabled={resolution.profile.disabled === null}>
            {t('disabled')}
          </option>
        </Select>
        <Select
          id="tokenLimitField"
          label={t('tokenLimitField')}
          value={model.parameters.tokenLimitField}
          onChange={(event) =>
            parameter('tokenLimitField', event.target.value as ModelDraft['parameters']['tokenLimitField'])
          }
        >
          <option value="auto">{t('automatic')}</option>
          <option value="max_tokens">max_tokens</option>
          <option value="max_completion_tokens">max_completion_tokens</option>
        </Select>
        <Input
          id="maxConcurrent"
          type="number"
          min={1}
          max={8}
          step={1}
          required
          label={t('maxConcurrent')}
          hint={t('maxConcurrentHint')}
          value={model.maxConcurrent}
          onChange={(event) => onChange({ ...model, maxConcurrent: event.target.value })}
        />
        <Input
          id="batchSize"
          type="number"
          min={1}
          max={20}
          step={1}
          required
          label={t('batchSize')}
          hint={t('batchSizeHint')}
          value={model.batchSize}
          onChange={(event) => onChange({ ...model, batchSize: event.target.value })}
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
          onChange={(event) => onChange({ ...model, customThinking: event.target.value === 'custom' })}
        >
          <option value="auto">{t('thinkingAdapterAuto')}</option>
          <option value="custom">{t('thinkingAdapterCustom')}</option>
        </Select>
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
              onChange={(event) => onChange({ ...model, enabledBody: event.target.value })}
            />
            <Textarea
              id="thinkingDisabledBody"
              label={t('thinkingDisabledBody')}
              rows={5}
              maxLength={4096}
              spellCheck={false}
              disabled={!model.customThinking}
              value={model.disabledBody}
              onChange={(event) => onChange({ ...model, disabledBody: event.target.value })}
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
        onChange={(event) => parameter('systemPrompt', event.target.value)}
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
