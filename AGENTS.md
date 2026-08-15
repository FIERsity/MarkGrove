# AGENTS.md

## 作用域

本文件约束 MarkGrove 仓库。跨项目工作前必须先读取 `../070315-site/AGENTS.md`；跨项目长期策略以该主文件为准。用户最新明确指令始终优先。

## OWNER-MAINTAINED: 长期策略

### 产品定位

MarkGrove 是独立版本控制、部署到 GitHub Pages 的本地优先 Markdown 网页笔记工具。主站只维护公开入口，不复制本仓库源码。

默认面向约 `1440×900` 的桌面横屏。保持现有响应式能力基本可用，但除非用户明确要求，不新增竖屏专用工作流。

### 数据与隐私边界

- 笔记正文、标题、标签、索引、修订和备份处理必须留在浏览器本地。
- 不新增账号、云同步、协作、遥测、分析、AI、上传或第三方运行时服务，除非用户明确批准扩大范围。
- Service Worker 只缓存应用外壳，不得缓存笔记内容；不得通过运行时 CDN 加载核心依赖。
- 原始 HTML 默认不执行；预览不得静默加载远程图片；外链必须由用户明确点击。
- 浏览器存储、PWA 安装和持久存储权限都不得描述成备份。

### 数据安全不变量

- IndexedDB schema 变化使用新的有序 Dexie 版本和迁移测试，不得通过清库修复升级。
- 自动保存必须保持同笔记串行写入，旧异步结果不得覆盖新内容。
- 导入和备份恢复不得静默覆盖；永久删除必须二次确认并级联清理修订。
- 单篇导出保持可读 Markdown；整库备份使用版本化 manifest 与标准 `.md` 文件。
- 破坏兼容性的格式、备份协议或持久化变化属于大改动，实施前需取得用户确认。

## AGENT-MAINTAINED: 已验证事实

<!-- AGENT-MAINTAINED:START facts -->

- 运行时：Node.js >=24，React 19、TypeScript、Vite 8。
- 编辑与预览：CodeMirror 6 + Lezer GFM/Math 语法树提供默认可编辑 Live Preview；源码/实时预览共用编辑状态，`react-markdown` + remark-gfm/remark-math + 本地 KaTeX 只负责独立阅读与分栏视图；raw HTML 跳过，图片渲染为本地隐私占位。
- 结构化写作：Block、本文大纲与拖动目标均从当前 Markdown 语法树临时派生，不写入私有 block ID，不改变笔记、IndexedDB 或备份格式；Block 命令以单次 CodeMirror transaction 进入统一撤销历史。六点手柄用 pointer 手势拖动，放置盒子按 live preview 的 line block 计算；菜单浮到 document.body，避免光标盖住。指针拖动按兄弟块盒子和块间空隙命中，段落/标题可在列表内外转换，列表项可移出或加入另一列表；键盘与菜单仍只做同一父级重排。
- 编辑模式：当前键 `editorViewMode` 支持 `live`、`source`、`reading`、`split`；旧 `viewMode` 的 edit/split/preview 分别迁移为 source/live/live，不涉及 IndexedDB schema 变化。
- 持久化：Dexie/IndexedDB `markgrove`，当前 schema v3；`notes`、`folders`、`revisions`、`settings` 四表；v1/v2 原地迁移到根目录并保留旧修订。
- 工作区：文件夹与笔记统一稀疏排序；同一移动命令供指针拖动、键盘移动和对话框使用；文件夹禁止移入自身或后代。
- 备份：ZIP 格式 `markgrove-backup` 当前写出 v2，并显式读取 v1/v2；单篇 Markdown 8 MiB、恢复包 50 MiB、5,000 篇上限。
- PWA：`registerType: "prompt"`；Workbox `runtimeCaching: []`，只预缓存应用 shell。
- 最低验证：`npm run check`，等价于 test + lint + build；文件与 PWA 改动另做桌面浏览器检查。
- 发布：`main` 经 `.github/workflows/pages.yml` 验证后发布 `dist/` 到 GitHub Pages；`dist/` 不追踪。
- 源码：`src/components/` 为 UI 构件，`src/lib/` 为存储、Markdown、搜索、备份等可测试核心逻辑，`public/` 为静态 PWA 资产。
- 界面：中英双语；语言切换与反馈入口在顶栏右侧。用户主动填写的反馈经 `https://feedback.070315.site/feedback` 提交，只发送正文、产品名 `MarkGrove` 和界面语言；笔记、文件夹、修订和备份不得附加。CSP `connect-src` 仅为此放行该主机。

<!-- AGENT-MAINTAINED:END facts -->

## 工作流程

1. 开始前执行 `git status --short --branch`，保留已有修改和本地材料。
2. 核心规则优先放入 `src/lib/` 并通过 Vitest 直接测试生产代码。
3. 数据迁移、导入导出、安全渲染、删除与恢复修改必须增加聚焦测试。
4. 运行 `npm run check`。涉及编辑器、文件、IndexedDB、PWA 或视觉时再做桌面浏览器验收。
5. 使用明确路径暂存，提交前检查 `git diff --cached`；不得提交 `dist/`、`node_modules/`、`output/`、测试截图或真实笔记。

## 文档维护

事实变化时同步更新本文件的 `AGENT-MAINTAINED` 区域和 README。影响工作区地图、公开地址、最低验证或主站入口时，同时更新 `../070315-site/AGENTS.md` 及主站入口文件。
