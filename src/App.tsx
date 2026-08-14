import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore, BookOpenText, Check, ChevronDown, Clock3, Download, FileDown, FileUp,
  FolderOpen, HardDrive, Languages, Menu, Moon, MoreHorizontal, Pin, PinOff, Plus,
  RotateCcw, Search, Settings, Sun, Tag, Trash2, Upload, Wifi, WifiOff,
} from "lucide-react";
import { Modal } from "./components/Modal";
import { createBackup, downloadBlob, inspectBackup } from "./lib/backup";
import { message, type MessageKey } from "./lib/i18n";
import { countCharacters, MAX_MARKDOWN_BYTES, parseMarkdown, safeFilename, serializeMarkdown } from "./lib/markdown";
import { collectTags, filterAndSortNotes } from "./lib/search";
import {
  addImportedNotes, createNote, deleteNoteForever, duplicateNote, ensureStarterNote, getSetting,
  isStoragePersistent, listNotes, listRevisions, moveToTrash, queueDraftSave, requestPersistentStorage,
  restoreNote, restoreRevision, setPinned, setSetting,
} from "./lib/storage";
import type { BackupPreview, Language, NoteDraft, NoteRecord, RevisionRecord, Theme, ViewMode } from "./types";

type SaveState = "saved" | "saving" | "failed";

const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));
const MarkdownPreview = lazy(() => import("./components/MarkdownPreview").then((module) => ({ default: module.MarkdownPreview })));

const STARTER_ZH = `# 欢迎来到 MarkGrove\n\n这里是一片只属于你的 Markdown 小树林。笔记保存在当前浏览器中，不需要账号，也不会上传正文。\n\n## 从这里开始\n\n- 在左侧新建或搜索笔记\n- 使用 **Markdown** 写作，在右侧查看预览\n- 定期使用“备份全部笔记”下载可恢复的 ZIP\n- [ ] 写下第一件想记住的事\n\n> 浏览器存储不是备份。重要笔记请主动导出。`;
const STARTER_EN = `# Welcome to MarkGrove\n\nThis is your private Markdown grove. Notes stay in this browser—no account and no document uploads.\n\n## Start here\n\n- Create or search notes in the left sidebar\n- Write in **Markdown** and preview on the right\n- Download a restorable ZIP with “Back up all notes”\n- [ ] Write down the first thing you want to remember\n\n> Browser storage is not a backup. Export important notes regularly.`;

function preferredLanguage(): Language {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function dateLabel(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(timestamp);
}

function asDraft(note: NoteRecord): NoteDraft {
  return { id: note.id, title: note.title, content: note.content, tags: note.tags };
}

export default function App() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [query, setQuery] = useState("");
  const [trashView, setTrashView] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [language, setLanguage] = useState<Language>(preferredLanguage());
  const [theme, setTheme] = useState<Theme>("light");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [online, setOnline] = useState(navigator.onLine);
  const [persistent, setPersistent] = useState(false);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [updateApp, setUpdateApp] = useState<null | (() => void)>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const draftRef = useRef<NoteDraft | null>(null);

  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => message(language, key, values), [language]);

  const reloadNotes = useCallback(async () => {
    const records = await listNotes();
    setNotes(records);
    return records;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storedLanguage = await getSetting<Language>("language", preferredLanguage());
      const storedTheme = await getSetting<Theme>("theme", "light");
      const storedView = await getSetting<ViewMode>("viewMode", "split");
      const storedBackup = await getSetting<number | null>("lastBackup", null);
      const starter = await ensureStarterNote(
        storedLanguage === "zh" ? "欢迎来到 MarkGrove" : "Welcome to MarkGrove",
        storedLanguage === "zh" ? STARTER_ZH : STARTER_EN,
      );
      const records = await listNotes();
      if (cancelled) return;
      setLanguage(storedLanguage);
      setTheme(storedTheme);
      setViewMode(storedView);
      setLastBackup(storedBackup);
      setNotes(records);
      const first = records.filter((note) => note.trashedAt === null)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)[0] ?? starter;
      const nextDraft = asDraft(first);
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setPersistent(await isStoragePersistent());
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language, theme]);

  const flushDraft = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = draftRef.current;
    if (!current) return;
    try {
      const saved = await queueDraftSave(current);
      setNotes((items) => items.map((item) => item.id === saved.id ? saved : item));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => { if (document.visibilityState === "hidden") void flushDraft(); };
    const handlePageHide = () => { void flushDraft(); };
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleUpdate = (event: Event) => {
      const custom = event as CustomEvent<() => void>;
      setUpdateApp(() => custom.detail);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("markgrove-update-available", handleUpdate);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("markgrove-update-available", handleUpdate);
    };
  }, [flushDraft]);

  const activeNote = useMemo(() => notes.find((note) => note.id === draft?.id) ?? null, [draft?.id, notes]);
  const visibleNotes = useMemo(
    () => filterAndSortNotes(notes, query, trashView, activeTag),
    [activeTag, notes, query, trashView],
  );
  const tags = useMemo(() => collectTags(notes), [notes]);

  function updateDraft(patch: Partial<NoteDraft>) {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setSaveState("saving");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void flushDraft(); }, 650);
  }

  async function selectNote(note: NoteRecord) {
    await flushDraft();
    const next = asDraft(note);
    draftRef.current = next;
    setDraft(next);
    setSaveState("saved");
  }

  async function handleNewNote() {
    await flushDraft();
    const note = await createNote(t("untitled"));
    await reloadNotes();
    setTrashView(false);
    setActiveTag(null);
    await selectNote(note);
  }

  async function showAllNotes() {
    setTrashView(false);
    setActiveTag(null);
    if (activeNote?.trashedAt !== null) {
      await flushDraft();
      const first = filterAndSortNotes(notes, "", false, null)[0] ?? null;
      const nextDraft = first ? asDraft(first) : null;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    }
  }

  async function showTrash() {
    await flushDraft();
    setTrashView(true);
    setActiveTag(null);
    const first = filterAndSortNotes(notes, "", true, null)[0] ?? null;
    const nextDraft = first ? asDraft(first) : null;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  async function showTag(tag: string | null) {
    await flushDraft();
    setTrashView(false);
    setActiveTag(tag);
    const first = filterAndSortNotes(notes, "", false, tag)[0] ?? null;
    const nextDraft = first ? asDraft(first) : null;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  async function afterActiveRemoved() {
    const records = await reloadNotes();
    const next = filterAndSortNotes(records, "", trashView, activeTag)[0] ?? null;
    const nextDraft = next ? asDraft(next) : null;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  async function handleTrash() {
    if (!activeNote || !window.confirm(t("trashConfirm"))) return;
    await flushDraft();
    await moveToTrash(activeNote.id);
    await afterActiveRemoved();
  }

  async function handleDeleteForever(note: NoteRecord) {
    if (!window.confirm(t("destructiveDelete"))) return;
    if (draft?.id === note.id) {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      draftRef.current = null;
    }
    await deleteNoteForever(note.id);
    if (draft?.id === note.id) await afterActiveRemoved();
    else await reloadNotes();
  }

  async function handleRestoreFromTrash(note: NoteRecord) {
    await restoreNote(note.id);
    const records = await reloadNotes();
    const restored = records.find((item) => item.id === note.id) ?? null;
    setTrashView(false);
    setActiveTag(null);
    const nextDraft = restored ? asDraft(restored) : null;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  async function handleImport(files: FileList | null) {
    if (!files) return;
    let imported = 0;
    let skipped = 0;
    for (const file of files) {
      try {
        if (!/\.(?:md|markdown|txt)$/i.test(file.name) || file.size > MAX_MARKDOWN_BYTES) throw new Error("INVALID_FILE");
        const parsed = parseMarkdown(file.name, await file.text());
        await createNote(parsed.title, parsed.content, parsed.tags, parsed.frontmatter);
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    await reloadNotes();
    setNotice(`${t("importDone", { count: imported })}${skipped ? t("importSkipped", { count: skipped }) : ""}`);
    if (markdownInputRef.current) markdownInputRef.current.value = "";
  }

  function handleExportNote() {
    if (!activeNote || !draft) return;
    const source = serializeMarkdown({ ...activeNote, ...draft });
    downloadBlob(new Blob([source], { type: "text/markdown;charset=utf-8" }), safeFilename(draft.title));
  }

  async function handleBackup() {
    await flushDraft();
    const current = await listNotes();
    const blob = await createBackup(current);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `markgrove-backup-${stamp}.zip`);
    const now = Date.now();
    setLastBackup(now);
    await setSetting("lastBackup", now);
  }

  async function handleBackupFile(file: File | undefined) {
    if (!file) return;
    try {
      const preview = await inspectBackup(file, new Set(notes.map((note) => note.id)));
      setBackupPreview(preview);
    } catch {
      setNotice(t("backupError"));
    }
    if (backupInputRef.current) backupInputRef.current.value = "";
  }

  async function confirmBackupRestore() {
    if (!backupPreview) return;
    await addImportedNotes(backupPreview.notes);
    setBackupPreview(null);
    await reloadNotes();
    setNotice(t("importDone", { count: backupPreview.notes.length }));
  }

  async function openHistory() {
    if (!draft) return;
    await flushDraft();
    setRevisions(await listRevisions(draft.id));
    setHistoryOpen(true);
  }

  async function handleRestoreRevision(revision: RevisionRecord) {
    const restored = await restoreRevision(revision);
    const nextDraft = asDraft(restored);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    await reloadNotes();
    setHistoryOpen(false);
  }

  async function changeLanguage(next: Language) {
    setLanguage(next);
    await setSetting("language", next);
  }

  async function changeTheme(next: Theme) {
    setTheme(next);
    await setSetting("theme", next);
  }

  async function changeView(next: ViewMode) {
    setViewMode(next);
    await setSetting("viewMode", next);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark"><BookOpenText size={20} /></span>
          <div><strong>MarkGrove</strong><small>{language === "zh" ? "本地 Markdown 笔记本" : "Local Markdown notebook"}</small></div>
        </div>
        <div className="topbar-status">
          <span className={`save-state ${saveState}`}><Check size={14} />{t(saveState === "saving" ? "saving" : saveState === "failed" ? "saveFailed" : "saved")}</span>
          <span title={online ? t("online") : t("offline")}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}</span>
          <button type="button" className="icon-button" aria-label={t("settings")} onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
        </div>
      </header>

      {updateApp && <div className="update-banner"><span>{t("updateReady")}</span><button type="button" onClick={updateApp}>{t("updateNow")}</button></div>}
      {notice && <button type="button" className="notice" onClick={() => setNotice(null)}>{notice}<span>×</span></button>}

      <main className="workspace">
        <aside className="library-sidebar">
          <div className="sidebar-actions">
            <button type="button" className="primary-action" onClick={() => void handleNewNote()}><Plus size={17} />{t("newNote")}</button>
            <details className="menu-details">
              <summary className="icon-button" aria-label={t("more")}><MoreHorizontal size={18} /></summary>
              <div className="dropdown-menu">
                <button type="button" onClick={() => markdownInputRef.current?.click()}><FileUp size={16} />{t("importMarkdown")}</button>
                <button type="button" onClick={() => void handleBackup()}><Download size={16} />{t("backup")}</button>
                <button type="button" onClick={() => backupInputRef.current?.click()}><Upload size={16} />{t("restoreBackup")}</button>
              </div>
            </details>
          </div>
          <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} /></label>
          <nav className="library-nav" aria-label="Library">
            <button type="button" className={!trashView && !activeTag ? "active" : ""} onClick={() => void showAllNotes()}><FolderOpen size={16} />{t("allNotes")}<span>{notes.filter((note) => note.trashedAt === null).length}</span></button>
            <button type="button" className={trashView ? "active" : ""} onClick={() => void showTrash()}><Trash2 size={16} />{t("trash")}<span>{notes.filter((note) => note.trashedAt !== null).length}</span></button>
          </nav>
          {tags.length > 0 && <div className="tag-filter"><p><Tag size={13} />{t("tags")}</p>{tags.map(({ tag, count }) => <button type="button" className={activeTag === tag ? "active" : ""} key={tag} onClick={() => void showTag(activeTag === tag ? null : tag)}>#{tag}<span>{count}</span></button>)}</div>}
          <div className="note-list">
            {visibleNotes.map((note) => (
              <button type="button" key={note.id} className={`note-card ${draft?.id === note.id ? "active" : ""}`} onClick={() => void selectNote(note)}>
                <span className="note-card-title">{note.pinned && <Pin size={12} />}{note.title}</span>
                <span className="note-card-snippet">{note.content.replace(/[#>*_`\-[\]]/g, " ").replace(/\s+/g, " ").trim() || "Markdown"}</span>
                <span className="note-card-meta">{dateLabel(note.updatedAt, language)}{note.tags[0] && <em>#{note.tags[0]}</em>}</span>
              </button>
            ))}
            {visibleNotes.length === 0 && <div className="empty-list"><FolderOpen size={22} /><span>{query ? t("noResults") : t("noNotes")}</span></div>}
          </div>
          <div className="sidebar-foot"><HardDrive size={14} /><span>{t("localOnly")}</span><small>{lastBackup ? `${t("lastBackup")} ${dateLabel(lastBackup, language)}` : t("backupNever")}</small></div>
          <input ref={markdownInputRef} className="visually-hidden" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple onChange={(event) => void handleImport(event.target.files)} />
          <input ref={backupInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => void handleBackupFile(event.target.files?.[0])} />
        </aside>

        {draft && activeNote ? (
          <section className="note-workspace">
            <header className="note-toolbar">
              <div className="title-stack">
                <input className="note-title-input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} aria-label={language === "zh" ? "笔记标题" : "Note title"} />
                <label className="tag-input"><Tag size={13} /><input value={draft.tags.join(", ")} onChange={(event) => updateDraft({ tags: event.target.value.split(/[,，]/) })} placeholder={t("addTags")} /></label>
              </div>
              <div className="note-tools">
                <div className="view-switcher">
                  {(["edit", "split", "preview"] as const).map((mode) => <button type="button" key={mode} className={viewMode === mode ? "active" : ""} onClick={() => void changeView(mode)}>{t(mode)}</button>)}
                </div>
                <details className="menu-details note-menu">
                  <summary className="icon-button" aria-label={t("more")}><Menu size={18} /><ChevronDown size={12} /></summary>
                  <div className="dropdown-menu align-right">
                    <button type="button" onClick={() => void setPinned(activeNote.id, !activeNote.pinned).then(reloadNotes)}>{activeNote.pinned ? <PinOff size={16} /> : <Pin size={16} />}{t(activeNote.pinned ? "unpin" : "pin")}</button>
                    <button type="button" onClick={() => void duplicateNote(activeNote, language === "zh" ? "副本" : "copy").then(reloadNotes)}><FileDown size={16} />{t("duplicate")}</button>
                    <button type="button" onClick={handleExportNote}><Download size={16} />{t("exportMarkdown")}</button>
                    <button type="button" onClick={() => void openHistory()}><Clock3 size={16} />{t("history")}</button>
                    {activeNote.trashedAt === null
                      ? <button type="button" className="danger" onClick={() => void handleTrash()}><Trash2 size={16} />{t("moveToTrash")}</button>
                      : <><button type="button" onClick={() => void handleRestoreFromTrash(activeNote)}><ArchiveRestore size={16} />{t("restore")}</button><button type="button" className="danger" onClick={() => void handleDeleteForever(activeNote)}><Trash2 size={16} />{t("deleteForever")}</button></>}
                  </div>
                </details>
              </div>
            </header>
            <div className={`writing-area mode-${viewMode}`}>
              {viewMode !== "preview" && <section className="editor-pane" aria-label={t("edit")}><Suspense fallback={<div className="pane-loading">Markdown…</div>}><MarkdownEditor value={draft.content} onChange={(content) => updateDraft({ content })} theme={theme} label={language === "zh" ? "Markdown 编辑器" : "Markdown editor"} /></Suspense></section>}
              {viewMode !== "edit" && <section className="preview-pane" aria-label={t("preview")}><Suspense fallback={<div className="pane-loading">Preview…</div>}><MarkdownPreview content={draft.content} language={language} /></Suspense></section>}
            </div>
            <footer className="note-status"><span>Markdown · GFM</span><span>{countCharacters(draft.content)} {t("words")}</span><span>v{activeNote.revision}</span></footer>
          </section>
        ) : (
          <section className="no-selection"><BookOpenText size={38} /><h2>{t("noNotes")}</h2><button type="button" onClick={() => void handleNewNote()}><Plus size={16} />{t("newNote")}</button></section>
        )}
      </main>

      {settingsOpen && <Modal title={t("settings")} closeLabel={t("close")} onClose={() => setSettingsOpen(false)}>
        <div className="settings-grid">
          <section><h3><Languages size={17} />{t("language")}</h3><div className="segmented"><button type="button" className={language === "zh" ? "active" : ""} onClick={() => void changeLanguage("zh")}>中文</button><button type="button" className={language === "en" ? "active" : ""} onClick={() => void changeLanguage("en")}>English</button></div></section>
          <section><h3>{theme === "light" ? <Sun size={17} /> : <Moon size={17} />}{t("theme")}</h3><div className="segmented"><button type="button" className={theme === "light" ? "active" : ""} onClick={() => void changeTheme("light")}><Sun size={15} />Light</button><button type="button" className={theme === "dark" ? "active" : ""} onClick={() => void changeTheme("dark")}><Moon size={15} />Dark</button></div></section>
          <section className="storage-setting"><h3><HardDrive size={17} />{t("storage")}</h3><p>{t(persistent ? "storagePersistent" : "storageBestEffort")}</p>{!persistent && <button type="button" onClick={() => void requestPersistentStorage().then(setPersistent)}>{t("requestPersistence")}</button>}<small>{lastBackup ? `${t("lastBackup")}: ${dateLabel(lastBackup, language)}` : t("backupNever")}</small></section>
        </div>
      </Modal>}

      {historyOpen && <Modal title={t("history")} closeLabel={t("close")} onClose={() => setHistoryOpen(false)}>
        <div className="revision-list">{revisions.length === 0 ? <p>{t("revisionsEmpty")}</p> : revisions.map((revision) => <article key={revision.id}><div><strong>{revision.title}</strong><small>{dateLabel(revision.savedAt, language)} · v{revision.revision}</small><p>{revision.content.slice(0, 140) || "Markdown"}</p></div><button type="button" onClick={() => void handleRestoreRevision(revision)}><RotateCcw size={14} />{t("restoreRevision")}</button></article>)}</div>
      </Modal>}

      {backupPreview && <Modal title={t("restoreBackup")} closeLabel={t("close")} onClose={() => setBackupPreview(null)} footer={<><button type="button" className="secondary" onClick={() => setBackupPreview(null)}>{t("cancel")}</button><button type="button" className="primary" onClick={() => void confirmBackupRestore()}>{t("confirmRestore")}</button></>}>
        <div className="backup-preview"><ArchiveRestore size={30} /><p>{t("backupReady", { count: backupPreview.notes.length, conflicts: backupPreview.conflicts })}</p>{backupPreview.exportedAt && <small>{new Date(backupPreview.exportedAt).toLocaleString()}</small>}</div>
      </Modal>}
    </div>
  );
}
