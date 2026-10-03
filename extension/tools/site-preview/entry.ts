import { collectUnitsAsync, mutationIndexDelta } from '../../lib/collector';
import { render, restoreDom } from '../../lib/renderer';
import type { TranslationMode, TranslationUnit } from '../../lib/types';

const fixture = document.getElementById('fixture')!;
const status = document.getElementById('status')!;
const guide = document.getElementById('docs')!;
const action = document.getElementById('action')!;
let clicks = 0;
for (const el of [guide, action]) el.addEventListener('click', event => {
  event.preventDefault();
  document.getElementById('interaction')!.textContent = `原节点点击成功：${++clicks}`;
});
const translations: Record<string, string> = {
  'A useful project description.': '一个实用项目的介绍。',
  'Getting started': '快速开始',
  'Read the': '阅读', 'installation guide': '安装指南', 'and run': '并运行', 'carefully.': '，请谨慎操作。',
  Welcome: '欢迎', 'to the project.': '来到这个项目。',
  Thanks: '感谢', for: '提交', and: '以及',
  'Browser playback': '浏览器播放', fails: '失败',
  'Fix the playback issue': '修复播放问题', 'Pinned issue title': '置顶的问题标题',
  'Improve browser support': '改进浏览器支持', 'Steps to reproduce the issue.': '复现此问题的步骤。',
  'Improve the rendering pipeline': '改进渲染流程',
  'This also happens in the latest version.': '最新版本也有这个问题。',
  'Use the action below.': '使用下面的操作。', 'Release notes': '发布说明',
  'Improved browser compatibility.': '提升浏览器兼容性。', 'Architecture guide': '架构指南',
  'Components communicate using messages.': '组件通过消息进行通信。',
  'Additional reproduction steps.': '补充的复现步骤。',
  'Explore': '探索', 'our discoveries': '我们的发现', 'today.': '今天。',
  'Learning about our universe.': '了解我们的宇宙。',
  'Exploring our universe.': '探索我们的宇宙。',
  'Useful explanation.': '很有用的解释。',
  'A journey through space.': '一次太空之旅。',
  'Additional explanation.': '补充的解释。',
  Ask: '请', 'to review': '检查', '.': '。',
};
const translate = (text: string) => translations[text] ?? `译：${text}`;
let mode: TranslationMode = 'bilingual';
let units: TranslationUnit[] = [];
function paint(batch: TranslationUnit[]) {
  for (const unit of batch) render(unit, unit.rich ? unit.rich.slots.map(translate) : translate(unit.text), mode);
  status.textContent = `${mode} · ${units.length} 个单元 · 原节点保留：${document.getElementById('docs') === guide && document.getElementById('action') === action}`;
  document.getElementById('sent')!.textContent = units.flatMap(unit => unit.rich?.slots ?? [unit.text]).join('\n');
}
for (const next of ['bilingual', 'replace'] as const) {
  document.getElementById(next)!.addEventListener('click', async () => {
    restoreDom();
    mode = next;
    units = (await collectUnitsAsync(fixture)).units;
    paint(units);
  });
}
document.getElementById('restore')!.addEventListener('click', () => {
  restoreDom(); status.textContent = '已恢复原文';
});
document.getElementById('append')!.addEventListener('click', () => {
  const observer = new MutationObserver(() => {});
  observer.observe(fixture, { childList: true, subtree: true });
  const comment = document.createElement('section');
  const template = document.getElementById('additional-comment') as HTMLTemplateElement | null;
  if (template) comment.append(template.content.cloneNode(true));
  else comment.innerHTML = '<a>New commenter</a><div class="markdown-body"><p>Additional reproduction steps.</p></div><button>Reply</button>';
  fixture.querySelector('main')!.append(comment);
  const delta = mutationIndexDelta(observer.takeRecords(), units.map(u => u.el));
  observer.disconnect();
  units.push(...delta.added);
  paint(delta.added);
});
void collectUnitsAsync(fixture).then(result => {
  units = result.units;
  status.textContent = `已识别 ${units.length} 个正文单元，等待选择展示模式`;
});
