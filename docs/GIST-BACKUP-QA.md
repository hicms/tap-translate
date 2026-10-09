# Gist 备份实施验收

验证日期：2026-10-09。命令在 `extension` 目录执行。GitHub 请求由内存 HTTP 夹具响应，只有测试令牌；未向真实账户创建、修改或删除 Gist。

## 交付行为

- 文件导出/导入与 Gist 共用快照、预览、恢复和错误处理；保留旧设置 JSON 导入。
- Gist 为手动加密独立快照，每次上传后固定 revision 读回验证；历史保留，断开不删除。
- 密码和 GitHub token 只在当前页内存。持久化的 Gist 信息仅含设备、账户、最近记录和账户绑定的待核对操作。
- 丢失 POST 响应时不自动重试；明确 HTTP 413/422 拒绝不会遗留“结果未知”。
- 普通保存刷新本机对比。恢复预览之后发生的设置变更会阻止旧预览写入。撤销仅在当前页可用，保留恢复前内置规则的默认模式。

## 自动验证

| 命令 | 结果与边界 |
|---|---|
| `npm run compile` | 退出 0 |
| `npm run lint` | 退出 0 |
| `npm test` | 退出 0，48 文件、467 测试通过 |
| `npm test -- --run tests/backup-lock.test.ts` | 后补的 2 项锁测试通过；拒绝排队写入及无 Web Locks 环境 |
| `npm run build` | Chrome MV3 成功；保留既有大 chunk 提示 |
| `npm run build:firefox` | Firefox MV3 成功；保留既有大 chunk 提示 |
| `npx playwright test --project=chromium-ext e2e/backup-connection.spec.ts e2e/react-ui-connection.spec.ts e2e/gist-connection.spec.ts` | 既有文件完整恢复 1 项和 React 回归 4 项通过；Gist 补充用例最终复跑结果见下 |
| `npx playwright test --project=chromium-ext e2e/gist-connection.spec.ts` | 退出 0，最终 2 项通过，含浅/深色 Axe 和远端删除；合计 7 项相关 Chrome E2E 通过 |
| `npx playwright test --project=firefox-ext e2e/firefox.spec.ts --grep 'builds output exists'` | 产物检查通过 |
| `npx playwright test --project=firefox-ext e2e/firefox.spec.ts --grep 'loads temporary addon'` | 真实 Firefox 临时扩展加载及浏览无崩溃通过 |

大数据测试使用真实 Web Crypto：合法 JSON 恰好 20 MiB 的加密往返、认证成功但内层 20 MiB + 1 字节的拒绝、中文、多片、TTL 不续期、错误密码、认证头篡改、缺片、恶意 KDF 与格式拒绝。20 MiB 样本在 Node Web Crypto 中测试；浏览器流程使用正常大小样本及原生 Web Crypto。

服务测试覆盖固定 revision、raw URL 与 token 隔离、账户/公开性限制、分页、限流、权限撤销、两次独立备份、丢响应重连核对、未知结果不盲重试。Firefox 数据传输同意的申请时序和撤销用单元夹具验证。

## 界面检查

使用项目 Playwright 扩展夹具加载真实 Chrome 构建。流程覆盖连接、上传、普通设置保存后的差异、恢复预览、确认恢复、撤销、历史、刷新后重连、断开、丢响应核对、陈旧预览拒绝，以及远端删除后禁用恢复。

已检查 1280×900 桌面、390×844 窄屏和深色截图：对比在窄屏上下排列，动作换行，未见水平溢出。浅色与深色 Axe 检查均无 serious/critical 问题。恢复确认通过实际点击完成，主成功流程无页面或控制台错误。截图输出在系统临时目录 `tap-translate-gist-{desktop,mobile,dark,preview}.png`，不打包进扩展。

本轮曾遇到原生 fetch 的调用接收者错误，已修复并通过浏览器连接；增加的远端删除断言曾匹配错文案，已修正为实际提示。未放宽产品校验来通过测试。

## 未验证范围

- 真实 GitHub 最大请求容量、实际账号的 token 权限及完整远端 20 MiB 上传尚未测试。界面标明实验边界，平台拒绝时保留本地导出路径。
- Firefox Gist 设置页的原生权限弹窗与全流程未做端到端验证；当前证据为声明检查、权限单元测试、构建及临时扩展加载。
- 未进行真人屏幕阅读器测试。浏览器原生权限在 Chrome 自动化中预授权；权限拒绝和点击顺序由单元测试覆盖。
- Gist 新文案提供简体中文和英文；繁体中文、西班牙语、法语和俄语暂用显式英文回退。原有界面翻译保留。

独立只读复审已确认普通保存摘要刷新、明确上传拒绝、撤销默认规则语义、大包验证四项发现均解决，无新的关键或重要实现问题。
