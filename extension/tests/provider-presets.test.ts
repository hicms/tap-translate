import { describe, expect, it } from 'vitest';
import {
  findProviderPreset, getProviderPreset, isMiniMaxApiBase, PROVIDER_PRESETS,
} from '../lib/provider/presets';

describe('provider preset catalog', () => {
  it('includes MiniMax defaults and a logo for the picker', () => {
    const preset = getProviderPreset('minimax');
    expect(preset.apiBase).toBe('https://api.minimax.cn/v1');
    expect(preset.model).toBe('MiniMax-M3');
    expect(preset.iconPath).toBe('icons/providers/minimax.svg');
  });

  it('matches saved base URLs without trailing slash differences', () => {
    expect(findProviderPreset('https://api.minimax.cn/v1/').id).toBe('minimax');
    expect(findProviderPreset('https://api.siliconflow.cn/v1/').id).toBe('siliconflow');
    expect(findProviderPreset('https://ark.cn-beijing.volces.com/api/plan/v3/').id).toBe('ark-agent-plan');
    expect(findProviderPreset('https://ark.cn-beijing.volces.com/api/v3').id).toBe('custom');
    expect(findProviderPreset('https://example.test/v1').id).toBe('custom');
  });

  it('includes SiliconFlow defaults and its local logo', () => {
    const preset = getProviderPreset('siliconflow');
    expect(preset.apiBase).toBe('https://api.siliconflow.cn/v1');
    expect(preset.model).toBe('deepseek-ai/DeepSeek-V4-Flash');
    expect(preset.iconPath).toBe('icons/providers/siliconflow.svg');
  });

  it('keeps every catalog entry icon-backed for future additions', () => {
    expect(PROVIDER_PRESETS.every((preset) => preset.iconPath.length > 0)).toBe(true);
  });

  it('identifies MiniMax endpoints for request compatibility', () => {
    expect(isMiniMaxApiBase('https://api.minimax.cn/v1')).toBe(true);
    expect(isMiniMaxApiBase('https://api.openai.com/v1')).toBe(false);
  });
});
