// Local browser fixture preview. No extension settings, credentials or model calls.
// Run from extension/: node tools/site-preview/serve.mjs
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const style = await readFile(path.join(root, 'public/tap-translate.css'), 'utf8');
const sites = (await readdir(path.join(root, 'tests/fixtures/sites')))
  .filter(file => /^[a-z]+\.html$/.test(file)).map(file => path.basename(file, '.html'));
const routes = new Map([['/tap-translate.css', ['text/css; charset=utf-8', style]]]);
for (const site of sites) {
const prefix = site === 'github' ? '' : `/${site}`;
const bundle = await build({
  entryPoints: [path.join(here, 'entry.ts')], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'chrome110',
  plugins: [{
    name: 'preview-site-host',
    setup(builder) {
      // Only this test bundle maps localhost to the selected profile. Production hostname
      // resolution remains exact and is covered by content-policy.test.ts.
      builder.onResolve({ filter: /^\.\.\/sites$/ }, () => ({ path: 'site-preview', namespace: 'preview' }));
      builder.onLoad({ filter: /.*/, namespace: 'preview' }, () => ({
        contents: `import { ${site} } from ${JSON.stringify(path.join(root, `lib/sites/${site}.ts`))}; export const resolveSiteProfile = () => ${site};`,
        resolveDir: root, loader: 'ts',
      }));
    },
  }],
});
const fixture = await readFile(path.join(root, `tests/fixtures/sites/${site}.html`), 'utf8');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site} 站点适配验证</title><link rel="stylesheet" href="/tap-translate.css">
<style>body{margin:0;font:16px/1.6 system-ui;background:#f6f8fa;color:#1f2328}#controls{position:sticky;top:0;padding:16px 24px;background:white;border-bottom:1px solid #d0d7de;z-index:2}button{padding:6px 12px;margin:4px;border:1px solid #d0d7de;border-radius:6px;background:white;cursor:pointer}#status{display:block;color:#0969da}#fixture{max-width:900px;margin:auto;padding:24px}main{padding:24px;background:white;border:1px solid #d0d7de;border-radius:8px}a{color:#0969da}nav{display:flex;gap:16px}h1{font-size:24px}h2{font-size:21px}code,pre{background:#eff1f3}pre{white-space:pre-wrap}article{border-top:1px solid #d0d7de;padding-top:16px}[contenteditable],textarea{border:1px solid #d0d7de;padding:8px}#sent{max-height:180px;overflow:auto;font-size:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){#fixture,main{padding:12px}#controls{padding:10px}}</style>
<div id="controls"><strong>${site} 内容规则 · 本地样本</strong>（使用固定译文）<nav>${sites.map(name => `<a href="${name === 'github' ? '/' : `/${name}/`}">${name}</a>`).join(' ')}</nav><div><button id="bilingual">双语</button><button id="replace">替换原文</button><button id="restore">恢复</button><button id="append">追加评论</button></div><output id="status"></output><output id="interaction"></output><details><summary>待翻译文本</summary><pre id="sent"></pre></details></div>
<div id="fixture">${fixture}</div><script src="${prefix}/preview.js"></script></html>`;
routes.set(`${prefix}/`, ['text/html; charset=utf-8', html]);
routes.set(`${prefix}/preview.js`, ['text/javascript; charset=utf-8', bundle.outputFiles[0].text]);
}
const server = http.createServer((request, response) => {
  const route = routes.get(new URL(request.url, 'http://localhost').pathname);
  response.writeHead(route ? 200 : 404, { 'Content-Type': route?.[0] ?? 'text/plain', 'Cache-Control': 'no-store' });
  response.end(route?.[1] ?? 'Not found');
});
server.listen(0, '127.0.0.1', () => console.log(`Site preview: http://127.0.0.1:${server.address().port}`));
