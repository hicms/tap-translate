// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveSiteProfile, siteProfiles } from '../lib/sites';
import { resolveContentPolicy } from '../lib/sites/policy';
import { normalizeSiteContentRules, SITE_CONTENT_LIMITS } from '../lib/sites/validation';
import { checkSiteContent, contentCheckResultSchema } from '../lib/sites/check';
import { installContentPolicy, isContentCandidate, isPreservedElement } from '../lib/collector/content-policy';
import { collectUnits, collectUnitsAsync, extractRichSlots, mutationIndexDelta } from '../lib/collector';
import { buildSafeRichSkeleton, render, restoreDom } from '../lib/renderer';

const host = location.hostname;
beforeEach(() => {
  installContentPolicy(document);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 24, bottom: 24, top: 0 } as DOMRect);
});
afterEach(() => { restoreDom(); installContentPolicy(document); document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('uses exact hosts, keeps aliases independent and never mutates the registry', () => {
  const rule = { host: 'x.com', content: ['.custom'], ignore: [] };
  expect(resolveContentPolicy('x.com', rule).content).toEqual({ mode: 'selectors', selectors: ['.custom'] });
  expect(resolveContentPolicy('www.x.com', rule).content).toEqual({ mode: 'selectors', selectors: resolveSiteProfile('www.x.com')!.content });
  for (const name of ['x.com.attacker.test', 'sub.x.com', 'unknown.test']) expect(resolveContentPolicy(name, rule).content.mode).toBe('generic');
  expect(Object.isFrozen(siteProfiles)).toBe(true);
  expect(Object.isFrozen(siteProfiles[0]!.content)).toBe(true);
});

it('inherits undefined fields across built-in upgrades, replaces arrays and resets by deleting overrides', () => {
  const builtin = resolveSiteProfile('github.com')!;
  const upgraded = { ...builtin, content: ['.new'], ignore: ['.new-ignore'] };
  expect(resolveContentPolicy('github.com', { host: 'github.com', ignore: [] }, upgraded)).toEqual({ content: { mode: 'selectors', selectors: ['.new'] }, ignore: [] });
  expect(resolveContentPolicy('github.com', { host: 'github.com', content: ['.old'] }, upgraded)).toEqual({ content: { mode: 'selectors', selectors: ['.old'] }, ignore: ['.new-ignore'] });
  expect(normalizeSiteContentRules([{ host: 'github.com' }])).toEqual([]);
  expect(resolveContentPolicy('github.com', undefined, upgraded).ignore).toEqual(['.new-ignore']);
});

it('validates CSS using DOM, identifies original line numbers and removes blanks / duplicates', () => {
  expect(normalizeSiteContentRules([{ host: 'https://EXAMPLE.com/', content: [' p ', '', 'p', '.missing'] }])).toEqual([{ host: 'example.com', content: ['p', '.missing'] }]);
  expect(() => normalizeSiteContentRules([{ host, content: ['p', '', '['] }])).toThrow(expect.objectContaining({ field: 'content', line: 3, code: 'syntax' }));
  expect(() => normalizeSiteContentRules([{ host, ignore: ['['] }])).toThrow(expect.objectContaining({ field: 'ignore', line: 1 }));
  for (const invalid of ['*.example.com', 'example.com/path']) expect(() => normalizeSiteContentRules([{ host: invalid, content: [] }])).toThrow();
  expect(() => normalizeSiteContentRules([{ host, content: Array(101).fill('p') }])).toThrow();
  expect(() => normalizeSiteContentRules([{ host, content: ['a'.repeat(2049)] }])).toThrow();
  expect(() => normalizeSiteContentRules(Array.from({ length: 201 }, (_, i) => ({ host: `h${i}.test`, content: [] })))).toThrow();
  const large = Array.from({ length: 10 }, (_, i) => ({ host: `h${i}.test`, content: Array(100).fill('a'.repeat(1000)) }));
  expect(JSON.stringify(large).length).toBeGreaterThan(SITE_CONTENT_LIMITS.bytes);
  expect(() => normalizeSiteContentRules(large)).toThrow();
});

it('distinguishes generic, ignore-only, no matches, and explicitly empty content', async () => {
  document.body.innerHTML = '<main><p id="one">First article sentence.</p><p class="skip">Second article sentence.</p></main>';
  installContentPolicy(document, { host, ignore: ['.skip'] });
  expect(collectUnits().map(unit => unit.text)).toEqual(['First article sentence.']);
  installContentPolicy(document, { host, content: ['.missing'], ignore: ['.skip'] });
  expect(collectUnits().map(unit => unit.text)).toEqual(['First article sentence.']);
  expect((await collectUnitsAsync(document.body)).units.map(unit => unit.text)).toEqual(['First article sentence.']);
  installContentPolicy(document, { host, content: [] });
  expect(collectUnits()).toEqual([]);
  expect((await collectUnitsAsync(document.body)).units).toEqual([]);
  installContentPolicy(document, { host: 'other.test', content: [] });
  expect(collectUnits()).toHaveLength(2);
});

it('uses page-wide matches for subtrees and rechecks after layout changes', async () => {
  document.body.innerHTML = '<main><p class="prose">Selected paragraph.</p><section><p>Outside paragraph.</p></section></main>';
  installContentPolicy(document, { host, content: ['.prose'], ignore: ['.skip'] });
  const section = document.querySelector('section')!;
  expect(collectUnits(section)).toEqual([]);
  expect((await collectUnitsAsync(section)).units).toEqual([]);
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    section.insertAdjacentHTML('beforeend', '<p>Outside addition.</p>');
    expect(mutationIndexDelta(observer.takeRecords(), []).added).toEqual([]);
    document.querySelector('main')!.innerHTML = '<section><p>Unadapted page paragraph.</p><p class="skip">Keep original.</p></section>';
    expect(mutationIndexDelta(observer.takeRecords(), []).added.map(u => u.text)).toEqual(['Unadapted page paragraph.']);
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<p class="prose">Late selected paragraph.</p>');
    expect(mutationIndexDelta(observer.takeRecords(), []).added.map(u => u.text)).toEqual(['Late selected paragraph.']);
    expect(collectUnits(document.querySelector('section')!)).toEqual([]);
  } finally {
    observer.disconnect();
  }
});

it('checks selector matches within the shadow tree when collecting its subtrees', async () => {
  document.body.innerHTML = '<p class="prose">Main document prose.</p><div id="shadow"></div>';
  installContentPolicy(document, { host, content: ['.prose'] });
  const shadow = document.getElementById('shadow')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<p>Shadow fallback paragraph.</p><button>Keep control.</button>';
  expect(collectUnits(shadow).map(u => u.text)).toEqual(['Shadow fallback paragraph.']);
  expect((await collectUnitsAsync(shadow)).units.map(u => u.text)).toEqual(['Shadow fallback paragraph.']);
  shadow.innerHTML = '<p class="prose">Selected shadow paragraph.</p><section><p>Outside shadow paragraph.</p></section>';
  expect(collectUnits(shadow.querySelector('section')!)).toEqual([]);
  expect(collectUnits(shadow).map(u => u.text)).toEqual(['Selected shadow paragraph.']);
});

it.each(['bilingual', 'replace'] as const)('preserves exclusions and restores generic fallback content (%s)', mode => {
  document.body.innerHTML = '<main><p>Read <span class="keep">BrandName</span> carefully.</p><p class="skip">Keep original.</p><pre>Code sample.</pre><button>Save settings.</button><div contenteditable="true">Draft text.</div><p translate="no">Opt out.</p></main>';
  installContentPolicy(document, { host, content: ['.missing'], ignore: ['.keep', '.skip'] });
  const units = collectUnits();
  expect(units.map(u => u.text)).toEqual(['Read carefully.']);
  const unit = units[0]!;
  const token = document.querySelector('.keep');
  expect(unit.rich?.slots).toEqual(['Read', 'carefully.']);
  render(unit, ['阅读', '仔细。'], mode);
  const target = mode === 'replace' ? unit.el : unit.el.querySelector('.tap-translate-target')!;
  expect(target.textContent).toBe('阅读 BrandName 仔细。');
  restoreDom();
  expect(unit.el.textContent).toBe('Read BrandName carefully.');
  expect(document.querySelector('.keep')).toBe(token);
});

it('uses the same policy for sync, async, incremental and rich skeletons; preserves identity, events and emoji', async () => {
  document.body.innerHTML = '<main><p class="prose">Read <a href="#ok"><img alt="🚀"></a> this <span class="notranslate"><img alt="👩🏽‍🚀"></span> guide. <button>Press</button></p><p>Outside prose.</p></main>';
  installContentPolicy(document, { host, content: ['.prose'], ignore: ['a'] });
  const units = collectUnits();
  expect(units).toHaveLength(1);
  expect((await collectUnitsAsync(document.body)).units.map(u => u.text)).toEqual(units.map(u => u.text));
  const unit = units[0]!;
  const skeleton = buildSafeRichSkeleton(unit.el);
  expect(extractRichSlots(skeleton)).toEqual(unit.rich!.slots);
  const link = unit.el.querySelector('a')!;
  const button = unit.el.querySelector('button')!;
  const click = vi.fn((e: Event) => e.preventDefault()); link.addEventListener('click', click); button.addEventListener('click', click);
  const original = unit.el.textContent;
  render(unit, ['阅读', '这份', '指南。'], 'replace');
  expect(unit.el.textContent).toBe('阅读  这份  指南。 Press');
  expect(link.previousSibling!.textContent).toBe('阅读 ');
  expect(link.nextSibling!.textContent).toBe(' 这份 ');
  expect(unit.el.querySelector('.notranslate')!.nextSibling!.textContent).toBe(' 指南。 ');
  expect(unit.el.querySelector('a')).toBe(link); expect(unit.el.querySelector('button')).toBe(button);
  link.click(); button.click(); expect(click).toHaveBeenCalledTimes(2);
  restoreDom(); expect(unit.el.textContent).toBe(original);
  link.click(); button.click(); expect(click).toHaveBeenCalledTimes(4);
  render(unit, ['阅读', '这份', '指南。'], 'bilingual');
  expect(unit.el.querySelector('.tap-translate-target')!.textContent).toBe('阅读 🚀 这份 👩🏽‍🚀 指南。 ');
  const added = document.createElement('p'); added.className = 'prose'; added.textContent = 'A newly added comment.'; document.querySelector('main')!.append(added);
  const delta = mutationIndexDelta([{ type: 'childList', addedNodes: [added], removedNodes: [], target: added.parentNode } as unknown as MutationRecord], []);
  expect(delta.added.map(u => u.text)).toEqual(['A newly added comment.']);
});

it('empty ignore cannot remove universal protection, even with broad content', () => {
  document.body.innerHTML = '<main><p>Visible paragraph.</p><pre><span>Code</span></pre><button><span>Control</span></button><div contenteditable="true"><p>Draft</p></div><div translate="no"><p>Opt out</p></div><div class="notranslate"><p>Keep</p></div><div class="tap-translate-target"><p>Extension</p></div></main>';
  installContentPolicy(document, { host, content: ['main'], ignore: [] });
  expect(collectUnits().map(u => u.text)).toEqual(['Visible paragraph.']);
  for (const el of document.querySelectorAll('pre span, button span, div p')) expect(isPreservedElement(el)).toBe(true);
});

it.each(['div', 'span:not(.keep)'])('does not reapply %s against a rebuilt skeleton with stripped attributes', ignore => {
  document.body.innerHTML = '<p>Read <a href="#ok"><img alt="🚀"></a> this <span class="keep">guide</span> carefully.</p>';
  installContentPolicy(document, { host, content: ['p'], ignore: [ignore, 'a'] });
  const unit = collectUnits()[0]!;
  const skeleton = buildSafeRichSkeleton(unit.el);
  expect(extractRichSlots(skeleton)).toEqual(unit.rich!.slots);
  render(unit, unit.rich!.slots.map((_, i) => `译${i}`), 'bilingual');
  const target = unit.el.querySelector('.tap-translate-target')!;
  expect(target.querySelector('a')).not.toBeNull();
  expect(target.textContent).toContain('🚀');
  expect(target.textContent).toContain('译2');
});

it('checks draft counts without changing DOM or installed policy, and validates both boundaries', () => {
  document.body.innerHTML = '<p>One paragraph.</p><p>Another paragraph.</p>';
  installContentPolicy(document, { host, content: [] });
  const before = document.documentElement.outerHTML;
  const result = checkSiteContent({ action: 'checkSiteContent', rule: { host, content: ['p', '.absent'], ignore: [] } }, document);
  expect(result.content.map(r => r.count)).toEqual([2, 0]);
  expect(isContentCandidate(document.querySelector('p')!)).toBe(false);
  expect(document.documentElement.outerHTML).toBe(before);
  expect(contentCheckResultSchema.safeParse(result).success).toBe(true);
  expect(contentCheckResultSchema.safeParse({ ...result, html: 'forbidden' }).success).toBe(false);
  expect(() => checkSiteContent({ action: 'checkSiteContent', rule: { host: 'forged.test', content: ['p'] } }, document)).toThrow('CHECK_HOST_MISMATCH');
  expect(() => checkSiteContent({ action: 'checkSiteContent', rule: { host, content: ['['] } }, document)).toThrow();
  expect(() => checkSiteContent({ action: 'checkSiteContent', rule: { host, content: [3] } }, document)).toThrow();
});
