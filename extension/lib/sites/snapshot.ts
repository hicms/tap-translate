import { z } from 'zod';
import { normalizeSiteHost } from '../settings/site-host';
import { normalizeSelectors, normalizeSiteContentRules } from './validation';

export const siteProfileSchema = z.object({
  id: z.string().min(1).max(100),
  hosts: z.array(z.string().transform(normalizeSiteHost)).min(1).max(200),
  content: z.unknown().transform(value => normalizeSelectors(value, 'content', typeof document === 'undefined' ? undefined : document)),
  ignore: z.unknown().transform(value => normalizeSelectors(value, 'ignore', typeof document === 'undefined' ? undefined : document)),
}).strict();

export const siteProfilesSchema = z.array(siteProfileSchema).max(200).superRefine((profiles, ctx) => {
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate site profile IDs' });
  }
  normalizeSiteContentRules(profiles.flatMap(profile => profile.hosts.map(host => ({
    host, content: profile.content, ignore: profile.ignore,
  }))));
});
