# TapTranslate

[English](README.md) | **中文**

TapTranslate 是一款 **网页翻译插件**，支持 Chrome、Edge、Firefox。通过任意 OpenAI 兼容 API（DeepSeek、OpenAI、Ollama 等）实现双语对照或全文替换翻译。

插件通过你配置的 API 翻译网页，并在浏览器本地缓存译文，减少重复请求。

**隐私：** 页面文字只发送到你配置的 API，API Key 保存在当前设备。

## 目录

- [特性](#特性)
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
- **设置导入 / 导出**：API Key 与请求头默认排除，需显式确认后才导出
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
└── Makefile
```

---

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

在 Chrome / Edge：`chrome://extensions` → **Load unpacked** → 选择 **`extension/output/chrome-mv3`**。
Firefox：`npm run dev:firefox`，加载 `extension/output/firefox-mv3`。

可选：复制 `extension/dev-settings.json.example` → 本地 JSON，填入 Key 后在扩展 Options 页导入。
**不要**把含密钥的文件放到 `extension/public/`——该目录会进入生产 zip。

**打包 / 发布：**

```bash
make build-extension        # 类型检查 + 构建 + 打包 chrome/firefox
```

产物：

- `extension/output/chrome-mv3/` · `extension/output/firefox-mv3/`（unpacked）
- `extension/output/*.zip`（并复制到 `dist/`，用于商店上架 / 侧载）

内容脚本以 WXT **unlisted script**（`tap-translate.js`）形式产出，点击翻译时通过 `chrome.scripting.executeScript` **按需注入**，不会自动注入所有页面。

### 使用

- 插件图标 → **翻译页面** / **恢复原文**
- Popup 切换目标语言与模式（双语对照 / 直接替换）
- 选中文字 → 右键 → **翻译选中文本**
- Options 可调并发、每批片段数、自定义请求头，并支持导入 / 导出 JSON

---

## Make 命令

```bash
make dev-extension          # 插件开发(Chrome)：WXT dev/HMR，自动打开或 Load unpacked output/chrome-mv3
make dev-extension-firefox  # 插件开发(Firefox)：WXT dev/HMR，自动打开或 output/firefox-mv3
make build            # 插件构建与打包 → dist/
make build-extension  # 仅插件：类型检查 + 构建 + zip（chrome/firefox）
make test             # 插件 compile + lint + vitest
make test-extension   # 仅插件 compile + lint + vitest
make test-e2e         # 插件 E2E：真实 Chromium/Firefox 加载构建产物跑 Playwright
make test-e2e-perf    # 性能预算 lab（Chromium + mock API）
make check-npm-audit  # 插件运行时 npm audit 门禁
make clean            # 删除 dist/ 与 extension/output/
```

