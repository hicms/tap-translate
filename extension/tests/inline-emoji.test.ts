// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { collectUnits, extractRichSlots } from '../lib/collector';
import { buildSafeRichSkeleton, render, restoreDom } from '../lib/renderer';

afterEach(() => { restoreDom(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

it.each(['🚀', '👩🏽‍🚀', '🇨🇳', '1️⃣', '#️⃣'])('retains emoji %s as a position boundary in both render modes', alt => {
  document.body.innerHTML = `<p>Start <img alt="${alt}" src="https://example.test/emoji.png"> here.</p>`;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 24, bottom: 24, top: 0 } as DOMRect);
  const paragraph = document.querySelector('p')!;
  const emoji = paragraph.querySelector('img')!;
  const unit = collectUnits()[0];
  expect(unit.rich?.slots).toEqual(['Start', 'here.']);
  const skeleton = buildSafeRichSkeleton(paragraph);
  expect(extractRichSlots(skeleton)).toEqual(['Start', 'here.']);
  expect(skeleton.querySelector('img')).toBeNull();
  expect(skeleton.querySelector('[translate="no"]')?.textContent).toBe(alt);
  render(unit, ['开始', '这里。'], 'replace');
  expect(emoji.previousSibling?.textContent).toBe('开始 ');
  expect(emoji.nextSibling?.textContent).toBe(' 这里。');
  expect(paragraph.querySelector('img')).toBe(emoji);
  restoreDom();
  render(unit, ['开始', '这里。'], 'bilingual');
  expect(paragraph.querySelector('.tap-translate-target')?.textContent).toBe(`开始 ${alt} 这里。`);
  expect(paragraph.querySelector('img')).toBe(emoji);
});

it.each(['A photo of a rocket 🚀', '123', '1🚀', '', '👩 astronaut', 'Landscape'])('does not turn ordinary image alt %j into an emoji token', alt => {
  document.body.innerHTML = `<p>Read <img alt="${alt}"> this <strong>guide</strong>.</p>`;
  const paragraph = document.querySelector('p')!;
  const skeleton = buildSafeRichSkeleton(paragraph);
  expect(skeleton.textContent).toBe('Read  this guide.');
  expect(skeleton.querySelector('[translate="no"],img')).toBeNull();
  expect(extractRichSlots(skeleton)).toEqual(extractRichSlots(paragraph));
});
