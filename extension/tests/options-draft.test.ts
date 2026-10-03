// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../lib/settings/schema';
import { DraftError, optionsDraft, readOptions, settingsPatch } from '../entrypoints/options/draft';

const t = (key: string) => key;
describe('options draft boundaries', () => {
  it.each(['', '-', '1e', '0x1', '0.001', 'Infinity', '3'])(
    'rejects invalid numeric draft %j at its owning field',
    (value) => {
      const draft = optionsDraft(createDefaultSettings());
      const provider = draft.providers[0]!;
      provider.models[0]!.parameters.temperature = value;
      try {
        readOptions(draft, t);
        throw new Error('Expected invalid draft');
      } catch (error) {
        expect(error).toBeInstanceOf(DraftError);
        expect((error as DraftError).location).toMatchObject({
          providerId: provider.id,
          modelId: provider.models[0]!.id,
          field: 'temperature',
        });
      }
      expect(provider.models[0]!.parameters.temperature).toBe(value);
    },
  );
  it('accepts decimal exponent drafts and blank automatic tokens, but rejects explicit zero and fractional counts', () => {
    const draft = optionsDraft(createDefaultSettings());
    const model = draft.providers[0]!.models[0]!;
    model.parameters.temperature = '3e-1';
    model.parameters.maxTokens = '';
    expect(readOptions(draft, t).providers![0]!.models[0]!.parameters).toMatchObject({
      temperature: 0.3,
      maxTokens: 0,
    });
    model.parameters.maxTokens = '0';
    expect(() => readOptions(draft, t)).toThrow('errNumericDraft');
    model.parameters.maxTokens = '';
    model.batchSize = '1.5';
    expect(() => readOptions(draft, t)).toThrow('errNumericDraft');
  });
  it('writes only the changed field despite storage and draft property ordering', () => {
    const baseline = createDefaultSettings();
    const draft = optionsDraft(baseline);
    expect(settingsPatch(readOptions(draft, t), baseline)).toEqual({});
    draft.sites[0]!.content = '.article';
    expect(settingsPatch(readOptions(draft, t), baseline)).toEqual({
      siteContentRules: [{ host: draft.sites[0]!.host, content: ['.article'] }],
    });
  });
  it('keeps an unfinished numeric draft and locates its model instead of saving zero', () => {
    const draft = optionsDraft(createDefaultSettings());
    const provider = draft.providers[0]!;
    const model = provider.models[0]!;
    model.parameters.temperature = '';
    try {
      readOptions(draft, t);
      throw new Error('Expected invalid draft');
    } catch (error) {
      expect(error).toBeInstanceOf(DraftError);
      expect((error as DraftError).location).toEqual({
        providerId: provider.id,
        modelId: model.id,
        field: 'temperature',
      });
    }
    expect(model.parameters.temperature).toBe('');
  });
  it('does not patch reordered or empty site preferences on an unrelated save', () => {
    const baseline = createDefaultSettings();
    baseline.siteRules = [
      { host: 'example.com', auto: true },
      { host: 'github.com', disabled: true },
      { host: 'empty.example' },
    ];
    const draft = optionsDraft(baseline);
    const saved = readOptions(draft, t, false);
    draft.targetLang = 'fr';
    expect(settingsPatch(readOptions(draft, t), saved)).toEqual({
      targetLang: 'fr',
    });
  });
  it('preserves invalid custom thinking JSON with its owning model location', () => {
    const draft = optionsDraft(createDefaultSettings());
    const provider = draft.providers[0]!;
    const model = provider.models[0]!;
    model.customThinking = true;
    model.disabledBody = '{';
    expect(() => readOptions(draft, t)).toThrow('thinkingJsonInvalid');
    expect(model.disabledBody).toBe('{');
  });
});
