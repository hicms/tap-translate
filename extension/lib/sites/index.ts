import { github } from './github';
import { x } from './x';
import { facebook } from './facebook';
import { reddit } from './reddit';
import { youtube } from './youtube';
import { instagram } from './instagram';
import { threads } from './threads';
import type { SiteProfile } from './types';

export const siteProfiles: readonly SiteProfile[] = Object.freeze([github, x, facebook, reddit, youtube, instagram, threads].map(profile => {
  Object.freeze(profile.content);
  Object.freeze(profile.ignore);
  Object.freeze(profile.hosts);
  return Object.freeze(profile);
}));

/** No wildcard guessing: e.g. github.io and github.com.example.org are unrelated. */
export function resolveSiteProfile(hostname: string, profiles: readonly SiteProfile[] = siteProfiles): SiteProfile | undefined {
  const host = hostname.toLowerCase();
  return profiles.find(profile => profile.hosts.includes(host));
}
