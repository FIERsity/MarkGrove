# MarkGrove

在浏览器里生长、始终归你所有的 Markdown 笔记本。

MarkGrove 是一个无需账号、本地优先、可离线使用的 Markdown 网页笔记工具。笔记正文、标题、标签、搜索索引和修订快照都保存在当前浏览器的 IndexedDB 中，不上传到服务器。

## 当前能力

- 文件夹与笔记组成同一棵资料树；支持任意层级、折叠、重命名、移动、解散和级联回收。
- Inbox、最近、收藏、全部笔记、标签与回收站组成轻量导航，不强迫用户先整理再写作。
- 鼠标拖动和键盘移动使用同一套排序规则；可放到目标前后或文件夹内部，结构操作可在当前会话撤销。
- `⌘/Ctrl K` 快速打开笔记或文件夹；侧栏可调宽、可折叠，并记住宽度。
- 默认使用可直接编辑的 Live Preview：非活动内容呈现阅读排版，光标进入时显露 Markdown；同时保留源码、阅读与分栏校对。
- 标题、强调、链接、引用、列表、代码和任务框都在同一个 CodeMirror 编辑状态中工作，切换视图不丢光标或撤销历史。
- 支持本地 KaTeX 数学排版：`$...$` 为行内公式，独占行的 `$$...$$` 为块公式；代码、转义美元符号和常见价格文本不会被误判。
- Markdown 结构会临时派生为可操作 Block；悬停段落可插入、拖动、上下移动、复制、删除或转换类型。拖动手柄可以把段落放进列表、把列表项移出，或在列表之间移动；键盘上下移动仍保持同一层级。
- 空白段落输入 `/` 可插入标题、列表、任务、引用、代码、公式和分隔线；多段选区可整体上移或下移，所有结构操作进入同一撤销历史。
- 可开关的本文大纲从标题实时生成；在 Live Preview/源码中定位编辑位置，在阅读视图中定位渲染标题，不向 Markdown 写入私有 ID。
- 650ms 防抖自动保存；同一笔记的写入串行执行，持续写作时定期保留最近 20 个本地快照。
- 导入 `.md`、`.markdown`、`.txt`；导出标准 Markdown 与 YAML frontmatter。
- 整库版本化 ZIP 备份会保留文件夹、顺序和笔记归属；ID 冲突会作为完整副本导入，不静默覆盖。
- 中英双语、浅色/深色主题、可安装 PWA 和离线应用外壳。
- 默认不执行原始 HTML、不自动加载 Markdown 图片，外链只在用户点击时打开。

> IndexedDB、PWA 安装和浏览器的“持久存储”权限都不是备份。重要笔记应定期使用“备份全部笔记”导出 ZIP。

## 本地开发

需要 Node.js 24 或更高版本。

```bash
npm ci
npm run dev
```

完整检查：

```bash
npm run check
```

`check` 依次运行 Vitest、Oxlint 和生产构建。编辑器输入、文件选择、下载、IndexedDB 刷新恢复和 PWA 行为还需在约 `1440×900` 的桌面浏览器中检查。

## 数据格式

- IndexedDB 当前 schema 为 v3；v1/v2 数据库可原地升级，旧笔记会按稳定顺序进入根目录且正文、修订保持不变。
- 单篇导出为带 YAML frontmatter 的标准 `.md` 文件。
- 整库备份包含 `manifest.json` 与 `notes/*.md`，当前写出格式为 v2；恢复器继续显式兼容 v1。
- 单个 Markdown 文件上限 8 MiB，整库恢复包上限 50 MiB、最多 5,000 篇笔记。

详细规范：[`v0.2 工作区`](docs/workspace-v0.2-spec.md) · [`v0.3 实时预览`](docs/live-preview-v0.3-spec.md) · [`v0.4 结构化写作`](docs/structured-writing-v0.4-spec.md)。

## 发布

`main` 推送会运行 `npm ci` 和 `npm run check`，然后通过 GitHub Actions 发布 `dist/` 到 GitHub Pages。Vite 使用相对 `base`，生产地址规划为：

`https://FIERsity.github.io/MarkGrove/`

---

## English

MarkGrove is a private, local-first Markdown notebook that lives in your browser. It needs no account, works offline, and keeps note text, titles, tags, search data, and revision snapshots in local IndexedDB.

It includes a unified folder-and-note tree, pointer and keyboard reordering, quick open, an editable Live Preview backed by CodeMirror, local KaTeX math, Markdown-derived block controls, slash commands, a live outline, source and reading views, autosave, trash and restore, Markdown import/export, versioned ZIP backups, bilingual UI, themes, and an installable PWA shell.

Browser storage is not a backup. Export a ZIP regularly if the notes matter.
