# TapTranslate

[English](README.md) | **中文**

TapTranslate 是一款 **网页翻译插件**，支持 Chrome、Edge、Firefox。通过任意 OpenAI 兼容 API（DeepSeek、OpenAI、Ollama 等）实现双语对照或全文替换翻译。

插件通过你配置的 API 翻译网页，并在浏览器本地缓存译文，减少重复请求。

**隐私：** 页面文字只发送到你配置的 API，API Key 保存在当前设备。

**许可证：** [MIT](LICENSE)。

## 目录

- [特性](#特性)
- [项目结构](#项目结构)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [Make 命令](#make-命令)
- [文档导航](#文档导航)

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [docs/PERF_LAB.md](docs/PERF_LAB.md) | 性能预算 lab |
| [docs/FIREFOX_E2E.md](docs/FIREFOX_E2E.md) | Firefox E2E（Gecko harness 说明） |
| [docs/THINKING.md](docs/THINKING.md) | 模型思考开关、MiniMax 差异与自定义参数适配 |

---

## 特性

### 浏览器插件（Chrome / Edge / Firefox，Manifest V3）

- **双语对照** 或 **直接替换**，Options 默认 + Popup 临时切换
- **按需注入**：点击翻译时注入 content script，兼容更多站点
- **视口懒翻译**：IntersectionObserver 仅翻译进入视口（含预取一屏）的内容，滚动时按需补齐，省 token
- **增量翻译**：MutationObserver 持续监听动态内容，只索引新增节点
- **失败自动重试**：指数退避（1s/4s/16s，3 次），仍失败则译文区显示可点击「↻」手动重试
- **本地翻译缓存**：内存 + `chrome.storage.local` LRU 两级缓存，重复内容零请求
- **浮层选词翻译**：Shadow DOM 隔离的悬浮结果（替代弹窗），支持右键菜单触发
- **键盘快捷键**：`Alt+T` 翻译 / 还原页面，`Alt+M` 切换双语 / 替换模式（快捷键可在浏览器设置中自定义）
- **站点规则**：在设置中逐站配置模式、目标语言、自动翻译或永不翻译；自动翻译会明确请求该站权限
- **批量请求**：可配置并发数与每批片段数，连续失败时自适应缩小批量
- **自定义 HTTP 请求头**：仅保存在当前设备；API Key 的 `Authorization` 优先
- **设置导入 / 导出与完整备份**：常规导出默认排除 API Key 与请求头；完整备份经确认后包含凭据、规则快照、有效缓存和引导状态
- **界面语言**：英语、简体中文、繁體中文、俄语、西班牙语、法语
- **目标语言**：简体中文、English、Русский、Español、Français

## 项目结构

```text
tap-translate/
├── extension/                 # 浏览器插件源码（TypeScript + WXT）
│   ├── entrypoints/           # background / tap-translate(按需注入) / popup / options
│   ├── lib/                   # 分层：collector·renderer·scheduler·provider·cache·settings·i18n
│   ├── public/                # _locales、图标、注入用样式 tap-translate.css
│   ├── tests/                 # vitest 单测
│   └── wxt.config.ts          # 自动生成 Chrome/Firefox MV3 manifest
├── scripts/                   # 构建 / 开发脚本
├── artifacts/                 # 本地产物：extension/、cache/、test-results/、reports/ 等（不提交）
└── Makefile
```

生成路径统一由 [artifact-paths.mjs](extension/tools/artifact-paths.mjs) 管理。npm 的 `extension/node_modules/` 和当前 WXT 固定生成的 `extension/.wxt/` 保留默认位置，均不提交。

---

## 架构概览

基于 TypeScript + WXT（Manifest V3），界面使用 React 19 + [Astryx](https://github.com/facebook/astryx)，不包含独立后端服务。

- **扩展页面**（`entrypoints/popup`、`options`、`onboarding`）：采用 React 组件，文本及数字输入、下拉、多选、单选、文件选择和弹窗均复用 `ui/` 中的 Astryx 控件与主题。不支持 CSS 锚点定位的浏览器使用 Astryx 底部选择面板。设置页独立维护供应商、模型及站点的编辑草稿，校验后仅保存变化字段。
- **划词浮层**（`lib/overlay`）：在隔离的 ShadowRoot 内挂载 React + Astryx。字体、脚本和样式均来自本地，扩展主题不会改动网页样式。
- **内容脚本**（`entrypoints/tap-translate.ts`）：每个 frame 独立运行会话；`collector` + `sites` 识别正文，`scheduler` 管理视口队列和重试，`renderer` 展示译文或恢复原文。
- **扩展后台**（`entrypoints/background.ts`）：通过 `runtime.Port` 接收未命中缓存的批次，统一限制跨标签页并发，由 `provider` 调用用户配置的 API。

翻译链路：采集 → 视口队列 → 内存/本地缓存 → 后台 API 请求 → 渲染。站点规则及扩展方式见[站点适配文档](docs/SITE-ADAPTERS.md)。

网页中的行内译文仍由页面渲染器管理；内容脚本按需注入，后台处理不加载 React。Astryx 使用预构建 CSS 和 neutral 主题，无需额外的 StyleX 编译步骤。

为保留 Firefox 140 兼容性，构建时通过 `tools/astryx-theme.ts` 将 neutral 主题的 CSS scope 转为主题选择器；每个扩展页面或浮层使用单一主题。

## 快速开始

### 连接 API

1. 准备任意 OpenAI 兼容端点与 API Key（例如 DeepSeek）。
2. 加载插件（见下文「加载浏览器插件」）。
3. 打开 Options，填写：

| 设置 | 默认值（可改） |
|------|----------------|
| API base URL | `https://api.deepseek.com` |
| API key | 必填 |
| Model | `deepseek-v4-flash` |

### 加载浏览器插件

插件基于 **TypeScript + [WXT](https://wxt.dev)**，首次需要 `cd extension && npm ci`（Node ≥ 22）。

**日常开发（HMR 热更新）：**

```bash
make dev-extension          # 等价于 cd extension && npm run dev
```

在 Chrome / Edge：`chrome://extensions` → **Load unpacked** → 选择 **`artifacts/extension/chrome-mv3`**。
Firefox：`npm run dev:firefox`，加载 `artifacts/extension/firefox-mv3`。

可选：复制 `extension/dev-settings.json.example` → `extension/dev-settings.json`，填入 Key 后在扩展 Options 页导入，也供 live probe 读取。
**不要**把含密钥的文件放到 `extension/public/`——该目录会进入生产 zip。

**打包 / 发布：**

```bash
make build-extension        # 类型检查 + 构建 + 打包 chrome/firefox
```

产物：

- `artifacts/extension/chrome-mv3/` · `artifacts/extension/firefox-mv3/`（unpacked）
- `artifacts/extension/*.zip`（用于商店上架 / 侧载）

内容脚本以 WXT **unlisted script**（`tap-translate.js`）形式产出，点击翻译时通过 `chrome.scripting.executeScript` **按需注入**，不会自动注入所有页面。

### 构建与发版

在仓库根目录运行 `.\scripts\build.ps1`，会执行类型检查、lint、单测，并在 `artifacts/extension/` 生成 Chrome 和 Firefox 压缩包，同时把 Chrome 构建同步到根目录 `dist/`，可直接用于 Chrome 的“加载已解压的扩展程序”调试。只想快速打包时使用 `-SkipQuality`；也可以使用 `-ChromeOnly` 或 `-FirefoxOnly` 只构建一个浏览器。

提交源码到 `main` 后，先执行一次 `gh auth login`，再运行 `.\scripts\release.ps1 -Publish`。脚本会递增 patch 版本，更新 `extension/package.json` 和 `extension/package-lock.json`，提交版本变更，创建带注释的 `vX.Y.Z` tag，并原子推送 `main` 与 tag。使用 `-Version 0.2.0` 指定版本，使用 `-NoWait` 在推送后立即返回。tag workflow 会执行质量检查，生成 Chrome/Firefox ZIP 与 SHA-256 文件，并创建 GitHub Release。

### 使用

- 插件图标 → **翻译页面** / **恢复原文**
- Popup 切换目标语言与模式（双语对照 / 直接替换）
- 选中文字 → 右键 → **翻译选中文本**
- Options 可调并发、每批片段数、自定义请求头，并支持导入 / 导出 JSON

---

## Make 命令

```bash
make dev-extension          # 插件开发(Chrome)：WXT dev/HMR，加载 artifacts/extension/chrome-mv3
make dev-extension-firefox  # 插件开发(Firefox)：WXT dev/HMR，加载 artifacts/extension/firefox-mv3
make build            # 插件构建与打包 → artifacts/extension/
make build-extension  # 仅插件：类型检查 + 构建 + zip（chrome/firefox）
make test             # 插件 compile + lint + vitest
make test-extension   # 仅插件 compile + lint + vitest
make test-e2e         # 插件 E2E：真实 Chromium/Firefox 加载构建产物跑 Playwright
make test-e2e-perf    # 性能预算 lab（Chromium + mock API）
make check-npm-audit  # 插件运行时 npm audit 门禁
make clean            # 删除 artifacts/（保留依赖、本地配置和 .wxt 类型文件）
```


### 完整备份与恢复

在设置 → 数据中，先保存或放弃未保存的修改，再点击「导出完整备份」。文件包含全部服务和模型、参数与提示词、API Key（包括当前会话密钥）、HTTP 请求头、语言和翻译模式、网站偏好、自定义内容规则、内置网站规则快照、有效的本地翻译缓存、引导状态，以及网站授权清单。文件是**未加密的 JSON**，可能包含密钥和私人译文，请妥善保管。常规「导出」仍默认去除密钥和请求头，适合分享设置。

通过「导入设置」选择完整备份，核对预览后确认。完整恢复会替换设置、规则、缓存及引导状态；旧版设置 JSON 仍按文件中提供的字段更新。恢复前请停止翻译、关闭其他设置页面；恢复后刷新网页。会话密钥遵循原有持久保存选项（不支持 session storage 的浏览器沿用本地存储回退）。导入先验证文件，写入失败时尝试恢复原数据；如补偿也失败，会报告两类错误。浏览器多存储区没有原子事务，请勿在其他窗口同时编辑或翻译，也不要在恢复过程中关闭扩展。

内置规则快照独立保存，不占用自定义规则的 200 个站点限额。恢复后的界面、页面检查和翻译使用该快照；自定义规则逐字段覆盖快照。快照未列出的站点使用通用提取，不自动混入新版本的内置规则。导入 `{"builtinSiteProfiles":null}` 可恢复使用当前安装版本的内置规则；省略该字段则保留现状。

缓存遵循原有 7 天有效期、最多 5000 条及 4 MiB 译文预算；过期条目不会复活。缓存能否命中还取决于模型、参数、提示词版本等指纹是否兼容。隐私窗口的内存缓存不会导出，也不会在隐私窗口恢复持久缓存。备份文件上限为 20 MiB；不支持的完整备份版本会在写入前拒绝。

授权清单用于重新向浏览器申请网站权限，拒绝则不导入数据；已有授权不会被撤销，已批准的权限也不随数据回滚撤销。浏览器管理的 API 权限只作为记录保存；快捷键、隐私窗口访问开关、当前网页 DOM、正在执行的翻译任务和远端代理服务数据不在可自动恢复范围内。
