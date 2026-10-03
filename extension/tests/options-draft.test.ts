// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../lib/settings/schema';
import { DraftError, optionsDraft, readOptions, settingsPatch } from '../entrypoints/options/draft';

const t = (key: string) => key;
describe('options draft boundaries', () => {
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
    expect(settingsPatch(readOptions(draft, t), saved)).toEqual({ targetLang: 'fr' });
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
