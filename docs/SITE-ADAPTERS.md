# 站点内容适配

站点适配只回答两个问题：**哪里是需要阅读的正文，哪些片段必须保持原文**。翻译请求、缓存、并发、页面观察与 DOM 渲染继续使用通用实现。

## 结构与职责

```text
lib/sites/<site>.ts          域名 + 正文选择器 + 保留选择器
        ↓
lib/sites/index.ts           精确域名注册表，设置界面共用
        ↓
lib/sites/policy.ts          组合内置规则和当前域名用户覆盖
        ↓
lib/collector/content-policy.ts   统一正文边界与保留判断
        ↓
lib/collector/index.ts       分段、去重、同步/分时/增量采集
        ↓
现有 scheduler / provider   只发送已筛选的纯文本槽
        ↓
lib/renderer                双语安全副本 / 原 Text 节点替换
```

`SiteProfile` 只有 `id`、`hosts`、`content`、`ignore`。每个站点一个声明文件，注册表显式导入。注册表及其数组不可变，不支持站点回调、脚本或远端规则。用户设置中的 `SiteRule` 仍只负责自动翻译、禁止翻译、语言和模式；内容覆盖独立存于 `Settings.siteContentRules`。

- `content` 可以选择正文容器（例如 Markdown），也可以选择单独标题。容器仍按已有段落规则拆分；选择器本身不会使整篇文章成为一个请求。
- `ignore` 排除整个子树，包括被父段落包住的用户名、编号等片段。排除优先于正文包含。
- 命中站点且当前页面存在正文选择器匹配：按站点正文范围采集，未匹配区域保持原文。当前页面没有任何正文选择器匹配时，回退通用采集，仍遵守生效排除和通用保护；显式空正文列表 `[]` 仍表示不收集。
- 每次同步、分时或增量采集都会重新检查当前 DOM，使页面切换和异步加载后的规则匹配及时生效。增量子树使用所属 Document 或 ShadowRoot 的匹配结果，不能因子树本身未匹配而绕过同一 DOM 树中已命中的规则。
- 未命中站点：沿用通用采集。所有站点共同遵守代码/表单控件/编辑区、`translate="no"` 和 `.notranslate` 等保护；保护覆盖后代元素。
- 规则在采集文本时生效，保留文本不会进入模型请求。普通链接的可读文字可以翻译，事件与链接目标保持。

## 在设置中维护规则

进入 **设置 → 站点**。左侧从同一注册表列出内置站点，并与自定义站点分组；选择站点后，在右侧“翻译偏好 / 内容适配”页签编辑。内置别名归在同一个列表项下，通过右侧域名选择框切换，仍然只编辑当前精确域名。浏览不会创建翻译偏好或用户覆盖。未知站点用“添加站点”建立草稿。每行一个 CSS 选择器，保存时去除空行和重复项。

列表与编辑区分别滚动，底部保存操作始终可见；切换站点或页签保留草稿。窄屏使用列表与编辑器之间的返回导航。保存和放弃更改作用于设置页全部草稿，继续按差异 patch 保存；校验失败会定位到对应站点与页签。翻译服务页面使用相同布局，左侧选择当前服务/模型，右侧切换基本和高级设置，测试连接按钮保持可见。

每个字段独立选择“使用内置/通用规则”或“自定义”。切到自定义时，当前生效值仅载入草稿；点击保存后才持久化。可分别恢复字段默认，也可恢复该域名全部内容默认；恢复是**删除用户字段或覆盖项**，不复制当前内置数组，且不删除自动翻译、模式、目标语言等偏好。

```ts
siteContentRules: [
  { host: 'github.com', ignore: [] },
  { host: 'example.com', content: ['article .body'], ignore: ['.advertisement'] },
]
```

| 用户字段 | 正文 `content` | 排除 `ignore` |
| --- | --- | --- |
| 未定义 | 继承内置正文；未知站点通用采集 | 继承内置排除；未知站点无站点排除 |
| 非空数组 | 完整替换正文列表；页面有匹配时只采集正文范围，无匹配时通用采集 | 完整替换站点排除列表 |
| 空数组 `[]` | 明确不收集任何正文，绝不回退全页 | 清除站点特定排除，通用保护仍有效 |

只配置 `ignore` 的未知站点继续通用采集。优先级是：**禁止翻译 > 通用保护/生效排除 > 正文范围**。代码、原生控件、编辑区、`translate=no`、`.notranslate`、扩展自身元素等保护不可通过覆盖取消。同步、分时、增量采集及 rich skeleton 使用同一 Document 策略快照。

沿用设置域名规范化，只按精确 hostname 匹配。不支持通配符、正则、路径或自动继承子域。`example.com` 与 `www.example.com` 独立覆盖；内置 hosts 别名仍各自匹配默认，覆盖其中一个不会覆盖其他别名。未覆盖字段随内置版本升级继承新默认，已覆盖字段保持用户版本。

### 校验与检查当前网页

语法由浏览器原生 DOM 解析，错误显示字段与原始行号；合法但匹配零个元素是正常结果。上限为 200 个域名、每字段 100 行、每选择器 2,048 字符、全部覆盖 JSON 的 UTF-8 大小 256 KiB。校验或保存失败会保留草稿并显示错误。

“检查当前网页”只在点击时执行。如果设置本身是活动标签，则选择同窗口最近访问的其他标签；可以先访问目标网页，再返回设置。检查前及内容脚本内都会核对精确域名。内部页面（如 `chrome://`）、扩展页、域名不一致或权限不足都会说明原因。没有权限时只请求目标站点所需权限；普通内容规则保存不需要网页访问权限。

检查使用当前草稿，分别列出每条正文/排除选择器的**元素匹配数**，不是最终翻译单元数。范围是目标页面的主文档，不跨入 iframe 或 shadow root。它不调用模型、不读取或发送正文、不记录 HTML、不修改 DOM、不停止翻译，也不保存草稿或安装临时全局策略。注入复用现有 frame liveness 路径，已运行的内容脚本不会重注入。消息和返回值均有结构/数量校验。

### 存储、导入导出与生效时机

覆盖存于 `chrome.storage.local`，不使用 sync 的单项配额；旧设置迁移为 `[]`。导出只包含用户覆盖，不包含内置注册表。导入显式提供 `siteContentRules` 时更新该字段；旧文件缺字段时保留已有覆盖。设置页相对加载基线保存差异 patch，不用旧表单快照覆盖并发 provider 或偏好修改。

**保存后，下次启动翻译使用新规则。** 保存不广播、不自动重跑正在翻译的标签。覆盖修改进入 revision；重新启动时旧会话先取消请求、停止观察、恢复旧 DOM，然后安装新策略重新采集。旧响应不能写入新会话。每个 iframe 根据浏览器提供的 sender URL 获取自身公开配置；广播启动参数不含顶层内容覆盖，不向内容脚本发送完整 Settings、API key 或 secret headers。

### 本次验证范围

单测覆盖精确域名、别名隔离、字段继承/替换/空值、内置升级、校验与大小限制、local/迁移/导入导出、revision、公开配置、会话取消与采集/渲染一致性。`e2e/site-content.spec.ts` 使用隔离 Chromium profile、现有 article fixture 和 loopback mock API，验证设置编辑、只读检查、保存/重新启动/恢复默认、偏好、写入失败及不同 hostname iframe。桌面与窄屏截图来自此合成场景，不代表所有真实站点端到端验证；未调用真实模型、登录账号或发送真实网站正文。

## GitHub 的阅读边界

仅自动识别 `github.com`，不把 GitHub Pages、文档子域或 Enterprise 域名猜成同一站点。

| 页面内容 | 行为与依据 |
| --- | --- |
| README、渲染后的 Markdown | 翻译 `main .markdown-body` 中的标题、段落、列表、表格文字 |
| Issue / PR 详情 | 翻译标题、描述、评论；标题以完整 `h1` 放置双语副本，编号保持原文和位置 |
| Issue / PR 列表 | 仅标题链接，不翻译整行；保持链接可点击，标签、作者、状态保留 |
| 置顶 Issue | 仅标题链接 |
| Release / Wiki | 复用 Markdown 正文规则；Wiki 自定义导航侧栏保留原文 |
| 仓库 About | 翻译介绍文字；桌面、移动容器分别匹配，隐藏版本由可见性检查过滤 |
| 已命中正文规则的页面中的文件树、代码、diff、导航、分支、标签、作者、时间、操作按钮 | 不收集 |
| 正文里的代码、快捷键、`@mention`、Issue 引用和 commit SHA | 保持原文与顺序，安全副本保留合法链接 |
| 评论编辑器、未提交的 Markdown 预览 | 不收集 |

Chrome 实查日期：2026-10-03。参考页面：

- [仓库主页](https://github.com/microsoft/vscode)
- [Issue 列表](https://github.com/microsoft/vscode/issues)、[Issue 详情](https://github.com/microsoft/vscode/issues/339451)
- [PR 列表](https://github.com/microsoft/vscode/pulls?q=is%3Apr+state%3Aclosed)、[PR 详情](https://github.com/microsoft/vscode/pull/21)
- [Releases](https://github.com/microsoft/vscode/releases)、[Wiki](https://github.com/microsoft/vscode/wiki)

优先使用 `.markdown-body`、`.markdown-title` 和 `data-testid` 等内容标识。置顶标题、桌面 About 当前没有同等稳定的语义属性，只在 `github.ts` 使用组件类名前缀，忽略生成的哈希后缀。不要把这些选择器散落到采集器、调度器或渲染器。标题容器使用现代浏览器支持的 `:has()`。

这是可维护的初始覆盖，不承诺 GitHub 每个产品页面均已适配。搜索、Projects、通知等页面如果没有命中正文选择器，会使用通用采集；有命中时，范围外的区域仍保持原文。未来按实际需求补选择器和样本。网页正文自身仍可包含未知的新结构，不能把此筛选当作安全隔离边界。

## 社交和视频站点

以下规则来自 2026-10-03 的 Chrome 公开页面实查，已接入同一注册表。每站只识别根域和 `www` 域名，不猜测移动版、旧版、帮助页或其它子域。六站共用 `prose-controls.ts` 的嵌入式控件排除列表；各自正文和保留标识由自己的规则文件维护。

下表描述页面已命中正文选择器时的范围。完全未命中的页面回退通用采集，表中由 `ignore` 声明的排除仍然生效。

| 站点 / 规则文件 | 翻译范围 | 保留与覆盖边界 |
| --- | --- | --- |
| X / `x.ts` | tweet article 内的 `tweetText`；公开简介 `UserDescription`；回复复用帖子结构 | 作者、时间、统计、操作区、输入框、展开按钮保留。正文链接是 handle、话题或 URL，保持原文；卡片预览未纳入 |
| Facebook / `facebook.ts` | `data-ad-preview=message` / `data-ad-comet-preview=message` 帖子；article 内带 `lang` 的 `span[dir=auto]` 评论 | 作者链接、时间、标题、互动区、编辑区保留。缺语言标记的评论、未知 Reels/群组结构不扩大匹配 |
| Reddit / `reddit.ts` | 当前 Shreddit 的 `title`、`text-body`、`comment` 命名 slot，包括信息流中包裹正文的 `a[slot="text-body"]` 帖子链接 | 排除 credit/meta/action/flair、用户和普通社区引用、广告容器；正文帖子链接不会被 `/r/` 链接排除规则误伤。没有为 old.reddit.com 或任意 `.md` 写兜底 |
| YouTube / `youtube.ts` | 观看标题、说明展开/摘要文本、`ytd-comment-view-model #content-text` 评论、明确的视频标题链接 | 频道名、播放器/订阅控件、计数、作者、编辑器及说明中的 URL/时间戳链接保留。播放器字幕、直播聊天、频道简介未纳入 |
| Instagram / `instagram.ts` | 公开帖子详情中与带时间的作者栏相邻的 caption / comment span | 排除作者链接、time、控件、表单、dialog；简介本身是按钮，因此保留。信息流、Reels、弹窗详情不承诺覆盖 |
| Threads / `threads.ts` | pressable-container 内的 dir=auto 正文和回复，要求当前 `1.4` 正文行高标记 | 排除链接、时间及含时间的独立 span、按钮、工具栏、dialog、导航；简介、预览卡片和未知结构保留 |

实查参考与观察范围：

- X：[NASA 主页](https://x.com/NASA)、[帖子及回复](https://x.com/NASA/status/2106061652617568263)。确认正文中提及、短链接和图片 emoji。
- Facebook：[NASA 主页](https://www.facebook.com/NASA)、[Meta 主页](https://www.facebook.com/Meta)。NASA 首个照片查看器没有可见 caption，随后在 Meta 公开帖子及两层评论确认正文标识，没有用空照片样本推断评论规则。
- Reddit：[NASA 社区](https://www.reddit.com/r/nasa/)、[链接帖评论](https://www.reddit.com/r/nasa/comments/1ww6not/nasas_x59_completes_record_six_flights_in_one_week/)、[文本帖](https://www.reddit.com/r/nasa/comments/1wvjz2y/astronomy_picture_of_the_day_has_discontinued_its/)。详情标题是 h1，信息流是标题链接，正文/嵌套回复位于 light DOM slot。
- YouTube：[NASA 频道](https://www.youtube.com/@NASA)、[说明样本](https://www.youtube.com/watch?v=6o3m9Bw67Os)、[评论样本](https://www.youtube.com/watch?v=sZfFevvUFUk)。第一个视频关闭评论，第二个视频确认了当前评论组件。
- Instagram：[NASA 主页](https://www.instagram.com/nasa/)、[公开帖子详情](https://www.instagram.com/nasa/p/DdHyaYAifb6/)。主页点击遇到注册提示，直接公开详情可查看 caption 和评论。没有登录或提交账号数据。
- Threads：[NASA 主页](https://www.threads.com/@nasa)、[公开串文及回复](https://www.threads.com/@nasa/post/Dd9aFLHgnnj)。公开页面允许有限回复，更多内容会触发登录提示。

Meta 的混淆类名不适合维护，因此只用语义标记、元素关系和当前正文样式标记。Instagram 的 `line-height` / `--x-lineHeight` 与 Threads 的 `1.4` 仍是较敏感的适配点，改版后优先复查这些文件，不增加“所有 dir=auto 文字”的兜底。

Instagram 的 caption 可能被外层 span 连同作者和时间包住，不能全局排除 `span:has(time)`。只排除真正的 time 和作者链接；交叠候选由现有文本节点去重处理。对应测试包含这层嵌套回归。

`tests/fixtures/sites/` 是精简、合成的结构样本，使用占位作者和文本，不保存真实账号内容。每站检查正文/负例、同步/分时、子树索引、新增回复、双语、替换、恢复、焦点和原节点点击。实页结构与样本测试分别提供证据；本次没有完成六站安装扩展并调用真实模型的端到端验证，也未验证私信、个性化首页及所有登录后页面。

## 为什么需要结构化文本槽

对 `Ask @alice to review --safe today.`，请求只包含 `Ask`、`to review`、`today.`；用户名和命令留在原位置。即使这一行还有任务列表复选框或操作按钮，也不能退化成把整句塞进第一个 Text 的替换方式。

源 DOM 的正文资格与文本槽的保留规则是两件事。双语副本会剥离 class/data 属性，因此安全构建器根据**源元素**的保留判断，为副本写入 `translate="no"`。文本槽遍历只检查保留规则，不要求这个断连副本仍匹配站点正文选择器。

替换模式继续原位更新 Text 节点，按钮、复选框、链接、监听器和焦点所属元素不被重建。恢复沿用原有快照机制。双语副本不会复制按钮和输入控件。

X / Facebook 的 emoji 有时是 `img`。仅当完整 alt 是 emoji 序列时，把它当作位置边界，译文副本用 `span[translate=no]` 写入相同 Unicode emoji，不复制图片或 src。源图片保留，文字在图片两侧原位替换；被保留链接或 `notranslate` 片段包住的纯图片 emoji 也遵守此规则。普通照片描述、数字及含 emoji 的说明不会被当作 emoji；覆盖旗帜、肤色、ZWJ、keycap 序列。

## 新增或维护一个站点

1. 在浏览器检查正文、列表、详情、异步新增内容和编辑器。先确定阅读范围，避免选整行、整个 main 或带大量 UI 的祖先容器。
2. 新增 `lib/sites/<site>.ts`，写精确域名、正文和保留选择器，在 `lib/sites/index.ts` 注册。普通适配不改 collector/provider/renderer。
3. 在 `tests/fixtures/sites/` 保存精简的公开 DOM 形状，去掉账户数据；添加对应测试。必须同时证明“该翻译的被收集”和“不该翻译的没有进入文本槽”。覆盖同步/分时/子树索引、追加评论、双语、替换、恢复及原节点交互。
4. 运行单测、类型、lint、构建；在浏览器验证实际页面选择器和本地样本的布局。更新本文件的覆盖和日期。

适配测试与完整检查：

```sh
cd extension
npx vitest run tests/*-site.test.ts tests/content-policy.test.ts tests/inline-emoji.test.ts
npm test
npm run compile
npm run lint
npm run build
```

本地交互预览：

```sh
node tools/site-preview/serve.mjs
```

在 Chrome 打开输出的 `127.0.0.1` 地址，用顶部链接切换六站或 GitHub 样本。切换双语/替换/恢复，点击原链接、按钮、GitHub 复选框并追加评论。预览使用实际 collector、renderer 和发布 CSS，仅在**测试构建**中将本地地址映射到选中的站点；生产域名匹配不变。新增站点的回复 template 同时供测试与预览使用。译文来自固定字典，不读取扩展设置、不调用模型。修改代码后停止并重启预览、刷新页面。

## 动态页面与边界

复用现有 MutationObserver 和增量索引，不增加站点专属观察器。新增评论、替换页面子树和已索引文本的 characterData 变化沿原有流程处理。已翻译宿主内部仅替换 childList、未改变 characterData 的情况仍有既有限制；此版本没有新增通用 SPA 重渲染协调机制。选择器或可见性只有属性变化时也不承诺自动补译。遇到这些情况可恢复后重新翻译。

现有文本有效性检查的上限是 1500 字符；长 caption 不保证完整收集。纯文本中的 hashtag / handle 没有链接或保留标识时，不做额外词法识别。这些属于通用采集能力的边界，新增站点规则不会改变它们。
