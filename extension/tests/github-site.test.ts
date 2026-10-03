// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/acme/project"}
import fixture from './fixtures/sites/github.html?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectUnits, collectUnitsAsync, extractRichSlots, mutationIndexDelta } from '../lib/collector';
import { render, restoreDom, buildSafeRichSkeleton } from '../lib/renderer';

const el = (id: string) => document.getElementById(id)!;
const texts = () => collectUnits().map(u => u.text);

beforeEach(() => {
  document.body.innerHTML = fixture;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 24, width: 600, height: 24, toJSON() {},
  });
});
afterEach(() => { restoreDom(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('GitHub content selection', () => {
  it('collects prose and titles exactly once, leaving chrome and machine identifiers out', () => {
    const units = collectUnits();
    const collected = units.map(u => u.text);
    for (const text of [
      'A useful project description.', 'Getting started',
      'Browser playback fails', 'Fix the playback issue', 'Pinned issue title',
      'Improve browser support', 'Steps to reproduce the issue.',
      'Improve the rendering pipeline', 'This also happens in the latest version.',
      'Improved browser compatibility.', 'Components communicate using messages.',
    ]) expect(collected.filter(t => t === text), text).toHaveLength(1);
    expect(collected.join(' ')).not.toMatch(/Dashboard|Repository shell|Star repository|source\.ts|Fix build|Labels|\bbug\b|yesterday|Unsubmitted|Draft|preview|Copy source|Run action|npm install|doNotTranslate|TapTranslate|@alice|#42|abcdef1|#339451|navigation/);
    expect(units.find(u => u.el === el('issue-title').parentElement)?.kind).toBe('block');
    expect(units.find(u => u.el.id === 'issue-link')?.kind).toBe('inner');
  });

  it('has identical sync/async policy, including subtree indexing', async () => {
    const shape = (units: ReturnType<typeof collectUnits>) => units.map(u => [u.el.id, u.text, u.kind, u.rich?.slots]);
    expect(shape((await collectUnitsAsync(document.body, { budgetMs: 0 })).units)).toEqual(shape(collectUnits()));
    expect(collectUnits(el('issue-title'))).toHaveLength(1);
    expect(collectUnits(el('star'))).toEqual([]);
    expect(collectUnits(document.querySelector('nav')!)).toEqual([]);
  });

  it('falls back to generic collection when no content selector matches', async () => {
    document.body.innerHTML = '<main><h1>Account settings</h1><p>Choose your preferences</p><button>Save</button></main>';
    expect(texts()).toEqual(['Account settings', 'Choose your preferences']);
    expect((await collectUnitsAsync()).units.map(u => u.text)).toEqual(texts());
  });

  it('keeps long Markdown split into paragraphs rather than translating the container', () => {
    el('readme').innerHTML = Array.from({ length: 25 }, (_, i) => `<p>Paragraph ${i} ${'Helpful documentation. '.repeat(5)}</p>`).join('');
    const units = collectUnits(el('readme'));
    expect(units).toHaveLength(25);
    expect(units.every(u => u.el.tagName === 'P')).toBe(true);
  });

  it('filters dynamically added comments, and a subsequently replaced page', async () => {
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { subtree: true, childList: true });
    const newContent = document.createElement('section');
    newContent.innerHTML = '<a>New commenter</a><div class="markdown-body"><p>Additional reproduction steps.</p></div><button>Reply</button>';
    document.querySelector('main')!.append(newContent);
    expect(mutationIndexDelta(observer.takeRecords(), collectUnits(el('readme')).map(u => u.el)).added.map(u => u.text)).toEqual(['Additional reproduction steps.']);
    observer.disconnect();
    document.querySelector('main')!.innerHTML = '<nav>New repository menu</nav><h1><bdi data-testid="issue-title">Another issue title</bdi><span>#100</span></h1>';
    expect((await collectUnitsAsync()).units.map(u => u.text)).toEqual(['Another issue title']);
  });
});

describe('GitHub rendering boundaries', () => {
  it.each(['bilingual', 'replace'] as const)('keeps task-list and control-adjacent protected tokens in order (%s)', (mode) => {
    el('readme').innerHTML = '<ul><li id="task"><input id="check" type="checkbox">Ask <a class="user-mention" href="/alice">@alice</a> to review <code><span>--safe</span></code> today.</li></ul><p id="control">Use <span class="notranslate">BrandName</span> now.<button id="run">Run</button></p>';
    const checkbox = el('check') as HTMLInputElement;
    const button = el('run');
    const click = vi.fn();
    button.addEventListener('click', click);
    const units = collectUnits(el('readme'));
    expect(units.map(u => u.rich?.slots)).toEqual([['Ask', 'to review', 'today.'], ['Use', 'now.']]);
    for (const unit of units) render(unit, unit.rich!.slots.map(t => `译:${t}`), mode);
    const task = mode === 'replace' ? el('task') : el('task').querySelector('.tap-translate-target')!;
    expect(task.textContent).toBe('译:Ask @alice 译:to review --safe 译:today.');
    const control = mode === 'replace' ? el('control') : el('control').querySelector('.tap-translate-target')!;
    expect(control.textContent).toBe(mode === 'replace' ? '译:Use BrandName 译:now.Run' : '译:Use BrandName 译:now.');
    checkbox.click(); button.click();
    expect(checkbox.checked).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('#check')).toHaveLength(1);
    expect(el('check')).toBe(checkbox);
    restoreDom();
    expect(el('task').textContent).toBe('Ask @alice to review --safe today.');
    expect(checkbox.checked).toBe(true);
    expect(el('run')).toBe(button);
  });

  it.each(['bilingual', 'replace'] as const)('preserves slots, token positions and interactions in %s mode', (mode) => {
    const guide = el('docs');
    const action = el('action');
    const click = vi.fn((event: Event) => event.preventDefault());
    guide.addEventListener('click', click);
    action.addEventListener('click', click);
    const originalText = el('protected').textContent;
    const originalToken = el('protected').querySelector('span')!;
    const units = collectUnits();
    const protectedUnit = units.find(u => u.el.id === 'protected')!;
    expect(protectedUnit.rich?.slots).toEqual(['Welcome', 'to the project.']);
    expect(extractRichSlots(buildSafeRichSkeleton(el('tokens')))).toEqual(extractRichSlots(el('tokens')));
    for (const unit of units) {
      render(unit, unit.rich ? unit.rich.slots.map(t => `译:${t}`) : `译:${unit.text}`, mode);
    }
    const translated = mode === 'replace' ? el('protected') : el('protected').querySelector('.tap-translate-target')!;
    expect(translated.textContent).toBe('译:Welcome TapTranslate 译:to the project.');
    expect(el('protected').querySelector('span[translate="no"]')).toBe(originalToken);
    expect(el('tokens').textContent).toContain('@alice');
    expect(el('tokens').textContent).not.toContain('译:@alice');
    expect(el('rich').querySelector('code')?.textContent).toBe('npm install');
    expect(el('docs')).toBe(guide);
    expect(el('action')).toBe(action);
    if (mode === 'bilingual') {
      const heading = el('issue-title').parentElement!;
      expect(heading.lastElementChild?.classList.contains('tap-translate-target')).toBe(true);
      expect(el('issue-title').querySelector('.tap-translate-target')).toBeNull();
      expect(el('issue-title').nextElementSibling?.textContent).toBe('#339451');
    }
    guide.click(); action.click();
    expect(click).toHaveBeenCalledTimes(2);
    expect(guide.getAttribute('href')).toBe('#intro');
    restoreDom();
    expect(el('protected').textContent).toBe(originalText);
    expect(el('docs')).toBe(guide);
    expect(document.querySelector('.tap-translate-target')).toBeNull();
  });
});
