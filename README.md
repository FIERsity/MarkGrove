# MarkGrove

在浏览器里生长、始终归你所有的 Markdown 笔记本。

MarkGrove 是一个无需账号、本地优先、可离线使用的 Markdown 网页笔记工具。笔记正文、标题、标签、搜索索引和修订快照都保存在当前浏览器的 IndexedDB 中，不上传到服务器。

## 当前能力

- 多笔记工作区：新建、搜索、标签、置顶、复制和回收站。
- CodeMirror Markdown 源码编辑器与安全 GFM 实时预览。
- 650ms 防抖自动保存；同一笔记的写入串行执行，持续写作时定期保留最近 20 个本地快照。
- 导入 `.md`、`.markdown`、`.txt`；导出标准 Markdown 与 YAML frontmatter。
- 整库版本化 ZIP 备份与恢复；ID 冲突会作为副本导入，不静默覆盖。
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

- IndexedDB 当前 schema 为 v2；v1 数据库可原地升级，测试会验证笔记正文不变。
- 单篇导出为带 YAML frontmatter 的标准 `.md` 文件。
- 整库备份包含 `manifest.json` 与 `notes/*.md`，当前备份格式版本为 v1。
- 单个 Markdown 文件上限 8 MiB，整库恢复包上限 50 MiB、最多 5,000 篇笔记。

## 发布

`main` 推送会运行 `npm ci` 和 `npm run check`，然后通过 GitHub Actions 发布 `dist/` 到 GitHub Pages。Vite 使用相对 `base`，生产地址规划为：

`https://FIERsity.github.io/MarkGrove/`

---

## English

MarkGrove is a private, local-first Markdown notebook that lives in your browser. It needs no account, works offline, and keeps note text, titles, tags, search data, and revision snapshots in local IndexedDB.

It includes a multi-note library, CodeMirror editing, safe GFM preview, autosave, trash and restore, Markdown import/export, versioned ZIP backups, bilingual UI, themes, and an installable PWA shell.

Browser storage is not a backup. Export a ZIP regularly if the notes matter.
