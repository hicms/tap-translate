// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.instagram.com/"}
import fixture from './fixtures/sites/instagram.html?raw';
import { socialSiteContract } from './social-site-contract';
import { expect, it } from 'vitest';
import { collectUnits } from '../lib/collector';

socialSiteContract('instagram', fixture, ["Explore our discoveries today.","Useful explanation."]);

it('keeps caption prose when an outer span also contains metadata and time', () => {
  document.querySelector('main')!.innerHTML = '<span dir="auto" style="--x-lineHeight:18px"><div><div><a href="/reader">Public author</a><span style="line-height:18px"><time>Yesterday</time></span></div><span style="line-height:18px">A caption beside metadata.</span></div></span>';
  expect(collectUnits().map(u => u.text)).toEqual(['A caption beside metadata.']);
});
