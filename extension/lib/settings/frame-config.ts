import { z } from 'zod';
import type { PublicSessionConfig, Settings } from '../types';
import { buildPublicSessionConfig } from './session-config';
import { hostOf } from './storage';

export const frameConfigRequestSchema = z.object({
  action: z.literal('getFrameSessionConfig'),
  sessionId: z.string().min(1).max(128),
  host: z.string().max(253).optional(),
  mode: z.enum(['bilingual', 'replace']),
  targetLang: z.enum(['zh-CN', 'en', 'ru', 'es', 'fr']),
});

/** The sender URL comes from the browser, never from the requesting message. */
export async function configForFrame(settings: Settings, senderUrl: string, raw: unknown): Promise<PublicSessionConfig> {
  const request = frameConfigRequestSchema.parse(raw);
  const url = new URL(senderUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported frame');
  const host = hostOf(senderUrl);
  return buildPublicSessionConfig(settings, host, {
    sessionId: request.sessionId,
    ...(request.host === host ? { mode: request.mode, targetLang: request.targetLang } : {}),
  });
}

/** Broadcast startup intent only; no frame receives another host's selectors. */
export function withoutContentOverride(config: PublicSessionConfig): PublicSessionConfig {
  return { ...config, siteContentRule: config.siteContentRule ? { host: config.siteContentRule.host } : undefined };
}
