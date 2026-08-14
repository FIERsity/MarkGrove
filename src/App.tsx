import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore, BookOpenText, Check, ChevronDown, ChevronRight, Clock3, Download,
  FileDown, FileUp, FolderOpen, FolderPlus, HardDrive, Languages, Menu, Moon,
  MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Plus, RotateCcw,
  Search, Settings, Sun, Tag, Trash2, Upload, Wifi, WifiOff,
} from "lucide-react";
import { LibraryOverview } from "./components/LibraryOverview";
import { Modal } from "./components/Modal";
import { MoveDialog } from "./components/MoveDialog";
import { QuickOpenDialog } from "./components/QuickOpenDialog";
import { WorkspaceTree, type TreeMoveRequest } from "./components/WorkspaceTree";
import { createBackup, downloadBlob, inspectBackup } from "./lib/backup";
import { message, type MessageKey } from "./lib/i18n";
import { countCharacters, MAX_MARKDOWN_BYTES, parseMarkdown, safeFilename, serializeMarkdown } from "./lib/markdown";
import { collectTags } from "./lib/search";
import {
  addImportedWorkspace, createFolder, createNote, deleteFolderForever, deleteNoteForever,
  dissolveFolder, duplicateNote, ensureStarterNote, getItemLocation, getSetting,
  isStoragePersistent, listRevisions, listWorkspace, markNoteOpened, moveItem, moveToTrash,
  queueDraftSave, renameFolder, requestPersistentStorage, restoreFolder, restoreItemLocation,
  restoreNote, restoreRevision, setPinned, setSetting, trashFolder, undoDissolveFolder,
} from "./lib/storage";
import {
  countFolderContents, folderBreadcrumbs, trashedFolderIds, visibleNotesForNavigation,
  type NavigationTarget,
} from "./lib/workspace";
import {
  ROOT_FOLDER_ID,
  type BackupPreview, type FolderRecord, type Language, type NoteDraft, type NoteRecord,
  type RevisionRecord, type Theme, type ViewMode, type WorkspaceItemKind,
} from "./types";

type SaveState = "saved" | "saving" | "failed";
type NodeTarget = { kind: WorkspaceItemKind; id: string };
type ToastState = { id: number; message: string; undo?: () => Promise<void> };

const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));
const MarkdownPreview = lazy(() => import("./components/MarkdownPreview").then((module) => ({ default: module.MarkdownPreview })));

const STARTER_ZH = `# 欢迎来到 MarkGrove\n\n这里是一片只属于你的 Markdown 小树林。笔记保存在当前浏览器中，不需要账号，也不会上传正文。\n\n## 从这里开始\n\n- 在左侧新建文件夹或笔记\n- 拖动树节点整理位置，也可以使用“移动到…”\n- 使用 **Markdown** 写作，在右侧查看预览\n- 定期下载可恢复的 ZIP 备份\n\n> 浏览器存储不是备份。重要笔记请主动导出。`;
const STARTER_EN = `# Welcome to MarkGrove\n\nThis is your private Markdown grove. Notes stay in this browser—no account and no document uploads.\n\n## Start here\n\n- Create folders and notes in the sidebar\n- Organize the tree by dragging or with “Move to…”\n- Write in **Markdown** and preview on the right\n- Download a restorable ZIP regularly\n\n> Browser storage is not a backup. Export important notes regularly.`;

function preferredLanguage(): Language { return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"; }
function dateLabel(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
function asDraft(note: NoteRecord): NoteDraft { return { id: note.id, title: note.title, content: note.content, tags: note.tags }; }

export default function App() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [navigation, setNavigation] = useState<NavigationTarget>({ kind: "all" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [language, setLanguage] = useState<Language>(preferredLanguage());
  const [theme, setTheme] = useState<Theme>("light");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [online, setOnline] = useState(navigator.onLine);
  const [persistent, setPersistent] = useState(false);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [moveTarget, setMoveTarget] = useState<NodeTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<NodeTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [updateApp, setUpdateApp] = useState<null | (() => void)>(null);
  const [sidebarWidth, setSidebarWidth] = useState(304);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const draftRef = useRef<NoteDraft | null>(null);
  const draftVersionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const reloadGeneration = useRef(0);
  const toastId = useRef(0);
  const undoHistoryRef = useRef<Array<() => Promise<void>>>([]);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => message(language, key, values), [language]);

  const reloadWorkspace = useCallback(async () => {
    const generation = ++reloadGeneration.current;
    const records = await listWorkspace();
    if (generation === reloadGeneration.current) { setNotes(records.notes); setFolders(records.folders); }
    return records;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedLanguage, storedTheme, storedView, storedBackup, storedExpanded, storedWidth, storedCollapsed] = await Promise.all([
        getSetting<Language>("language", preferredLanguage()), getSetting<Theme>("theme", "light"),
        getSetting<ViewMode>("viewMode", "split"), getSetting<number | null>("lastBackup", null),
        getSetting<string[]>("expandedFolderIds", []), getSetting<number>("sidebarWidth", 304),
        getSetting<boolean>("sidebarCollapsed", false),
      ]);
      await ensureStarterNote(storedLanguage === "zh" ? "欢迎来到 MarkGrove" : "Welcome to MarkGrove", storedLanguage === "zh" ? STARTER_ZH : STARTER_EN);
      const records = await listWorkspace();
      if (cancelled) return;
      setLanguage(storedLanguage); setTheme(storedTheme); setViewMode(storedView); setLastBackup(storedBackup);
      setExpandedIds(new Set(storedExpanded)); setSidebarWidth(Math.max(240, Math.min(420, storedWidth))); setSidebarCollapsed(storedCollapsed);
      setNotes(records.notes); setFolders(records.folders);
      const first = records.notes.filter((note) => note.trashedAt === null)
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)[0];
      if (first) { const next = asDraft(first); setSelectedNoteId(first.id); setDraft(next); draftRef.current = next; }
      setPersistent(await isStoragePersistent());
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language, theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 10_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const flushDraft = useCallback(async () => {
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const current = draftRef.current;
    if (!current) return null;
    const version = draftVersionRef.current;
    try {
      const saved = await queueDraftSave(current);
      setNotes((items) => items.map((item) => item.id === saved.id ? saved : item));
      if (draftRef.current?.id === saved.id && draftVersionRef.current === version) setSaveState("saved");
      return saved;
    } catch {
      if (draftRef.current?.id === current.id && draftVersionRef.current === version) setSaveState("failed");
      return null;
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => { if (document.visibilityState === "hidden") void flushDraft(); };
    const handlePageHide = () => { void flushDraft(); };
    const handleOnline = () => setOnline(true); const handleOffline = () => setOnline(false);
    const handleUpdate = (event: Event) => setUpdateApp(() => (event as CustomEvent<() => void>).detail);
    const handleGlobalKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setQuickOpen(true); }
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault(); setSidebarCollapsed((value) => { void setSetting("sidebarCollapsed", !value); return !value; });
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        const target = event.target;
        const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
        if (!editing) {
          const undo = undoHistoryRef.current.pop();
          if (undo) { event.preventDefault(); setToast(null); void undo(); }
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility); window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("online", handleOnline); window.addEventListener("offline", handleOffline);
    window.addEventListener("markgrove-update-available", handleUpdate); window.addEventListener("keydown", handleGlobalKey);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility); window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline);
      window.removeEventListener("markgrove-update-available", handleUpdate); window.removeEventListener("keydown", handleGlobalKey);
    };
  }, [flushDraft]);

  const activeNote = useMemo(() => notes.find((note) => note.id === selectedNoteId) ?? null, [notes, selectedNoteId]);
  const hiddenFolders = useMemo(() => trashedFolderIds(folders), [folders]);
  const tags = useMemo(() => collectTags(notes.filter((note) => !hiddenFolders.has(note.parentId))), [hiddenFolders, notes]);
  const overviewNotes = useMemo(() => visibleNotesForNavigation(notes, folders, navigation), [folders, navigation, notes]);
  const breadcrumbs = useMemo(() => activeNote ? folderBreadcrumbs(activeNote.parentId, folders) : [], [activeNote, folders]);

  function showToast(messageText: string, undo?: () => Promise<void>) {
    if (undo) { undoHistoryRef.current.push(undo); if (undoHistoryRef.current.length > 20) undoHistoryRef.current.shift(); }
    setToast({ id: ++toastId.current, message: messageText, undo });
  }
  function runUndo(undo: () => Promise<void>) {
    const index = undoHistoryRef.current.lastIndexOf(undo);
    if (index >= 0) undoHistoryRef.current.splice(index, 1);
    setToast(null); void undo();
  }
  function updateDraft(patch: Partial<NoteDraft>) {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...patch }; draftRef.current = next; setDraft(next);
    draftVersionRef.current += 1; setSaveState("saving");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void flushDraft(); }, 650);
  }

  function revealFolder(folderId: string) {
    const next = new Set(expandedIds);
    for (const folder of folderBreadcrumbs(folderId, folders)) next.add(folder.id);
    setExpandedIds(next); void setSetting("expandedFolderIds", [...next]);
  }

  async function openNote(id: string, focusTitle = false) {
    await flushDraft(); await markNoteOpened(id);
    const records = await reloadWorkspace(); const note = records.notes.find((item) => item.id === id);
    if (!note) return;
    const next = asDraft(note); setSelectedNoteId(id); setDraft(next); draftRef.current = next;
    draftVersionRef.current = 0; setSaveState("saved");
    if (note.parentId !== ROOT_FOLDER_ID) revealFolder(note.parentId);
    if (focusTitle) window.requestAnimationFrame(() => { titleInputRef.current?.focus(); titleInputRef.current?.select(); });
  }

  async function navigate(next: NavigationTarget) {
    await flushDraft(); setNavigation(next); setSelectedNoteId(null); setDraft(null); draftRef.current = null;
    if (next.kind === "folder") revealFolder(next.folderId);
  }

  function currentParentId(): string { return navigation.kind === "folder" ? navigation.folderId : activeNote?.parentId ?? ROOT_FOLDER_ID; }
  async function handleNewNote(parentId = currentParentId()) {
    await flushDraft();
    const tagsForNote = navigation.kind === "tag" ? [navigation.tag] : [];
    const note = await createNote(t("untitled"), "", tagsForNote, {}, parentId);
    await reloadWorkspace(); setNavigation(parentId === ROOT_FOLDER_ID ? { kind: "inbox" } : { kind: "folder", folderId: parentId });
    if (parentId !== ROOT_FOLDER_ID) revealFolder(parentId);
    await openNote(note.id, true);
  }
  async function handleNewFolder(parentId = currentParentId()) {
    const folder = await createFolder(t("untitledFolder"), parentId); await reloadWorkspace();
    const next = new Set(expandedIds); next.add(parentId); setExpandedIds(next); void setSetting("expandedFolderIds", [...next]);
    setRenameTarget({ kind: "folder", id: folder.id }); setRenameValue(folder.name); showToast(t("folderCreated"));
  }

  async function handleMove(request: TreeMoveRequest) {
    await flushDraft();
    const original = await moveItem(request.kind, request.id, request.parentId, request.targetIndex);
    const records = await reloadWorkspace();
    const name = request.kind === "note" ? records.notes.find((item) => item.id === request.id)?.title : records.folders.find((item) => item.id === request.id)?.name;
    if (request.parentId !== ROOT_FOLDER_ID) revealFolder(request.parentId);
    showToast(t("moved", { name: name ?? "" }), async () => { await restoreItemLocation(original); await reloadWorkspace(); });
  }

  async function handleTrash(kind: WorkspaceItemKind, id: string) {
    await flushDraft();
    const location = await getItemLocation(kind, id);
    const name = kind === "note" ? notes.find((note) => note.id === id)?.title : folders.find((folder) => folder.id === id)?.name;
    if (kind === "note") await moveToTrash(id); else await trashFolder(id);
    const records = await reloadWorkspace();
    if (selectedNoteId && !records.notes.some((note) => note.id === selectedNoteId && note.trashedAt === null && !trashedFolderIds(records.folders).has(note.parentId))) {
      setSelectedNoteId(null); setDraft(null); draftRef.current = null; setNavigation({ kind: "trash" });
    }
    const count = kind === "folder" ? countFolderContents(id, folders, notes) : null;
    const trashMessage = count
      ? (language === "zh" ? `已将“${name ?? ""}”及 ${count.folders} 个子文件夹、${count.notes} 篇笔记移到回收站` : `Moved “${name ?? ""}” with ${count.folders} subfolders and ${count.notes} notes to trash`)
      : t("trashed", { name: name ?? "" });
    showToast(trashMessage, async () => {
      if (kind === "note") await restoreNote(id); else await restoreFolder(id);
      await restoreItemLocation(location); await reloadWorkspace();
    });
  }

  async function handleDissolve(id: string) {
    const folder = folders.find((item) => item.id === id); if (!folder) return;
    const snapshot = await dissolveFolder(id); await reloadWorkspace();
    if (navigation.kind === "folder" && navigation.folderId === id) setNavigation(folder.parentId === ROOT_FOLDER_ID ? { kind: "inbox" } : { kind: "folder", folderId: folder.parentId });
    showToast(t("dissolved", { name: folder.name }), async () => { await undoDissolveFolder(snapshot); await reloadWorkspace(); });
  }

  function requestRename(kind: WorkspaceItemKind, id: string) {
    const name = kind === "note" ? notes.find((note) => note.id === id)?.title : folders.find((folder) => folder.id === id)?.name;
    setRenameTarget({ kind, id }); setRenameValue(name ?? "");
  }
  async function confirmRename() {
    if (!renameTarget) return;
    if (renameTarget.kind === "folder") await renameFolder(renameTarget.id, renameValue);
    else {
      const note = notes.find((item) => item.id === renameTarget.id);
      if (note) await queueDraftSave({ ...asDraft(note), title: renameValue });
      if (draftRef.current?.id === renameTarget.id) { const next = { ...draftRef.current, title: renameValue }; draftRef.current = next; setDraft(next); }
    }
    setRenameTarget(null); await reloadWorkspace();
  }

  async function restoreTrashedNote(id: string) { await restoreNote(id); await reloadWorkspace(); showToast(language === "zh" ? "笔记已恢复" : "Note restored"); }
  async function restoreTrashedFolder(id: string) { await restoreFolder(id); await reloadWorkspace(); showToast(language === "zh" ? "文件夹已恢复" : "Folder restored"); }
  async function deleteNote(id: string) {
    if (!window.confirm(t("destructiveDelete"))) return;
    await deleteNoteForever(id); await reloadWorkspace();
  }
  async function deleteFolder(id: string) {
    const folder = folders.find((item) => item.id === id); if (!folder) return;
    const count = countFolderContents(id, folders, notes);
    const promptText = language === "zh" ? `将永久删除 ${count.folders} 个子文件夹和 ${count.notes} 篇笔记。请输入文件夹名“${folder.name}”确认：` : `This permanently deletes ${count.folders} subfolders and ${count.notes} notes. Type “${folder.name}” to confirm:`;
    if (window.prompt(promptText) !== folder.name) return;
    await deleteFolderForever(id); await reloadWorkspace();
  }

  async function handleImport(files: FileList | null) {
    if (!files) return;
    let imported = 0; let skipped = 0; const parentId = currentParentId();
    for (const file of files) {
      try {
        if (!/\.(?:md|markdown|txt)$/i.test(file.name) || file.size > MAX_MARKDOWN_BYTES) throw new Error("INVALID_FILE");
        const parsed = parseMarkdown(file.name, await file.text());
        await createNote(parsed.title, parsed.content, parsed.tags, parsed.frontmatter, parentId); imported += 1;
      } catch { skipped += 1; }
    }
    await reloadWorkspace(); showToast(`${t("importDone", { count: imported })}${skipped ? t("importSkipped", { count: skipped }) : ""}`);
    if (markdownInputRef.current) markdownInputRef.current.value = "";
  }
  function handleExportNote() {
    if (!activeNote || !draft) return;
    downloadBlob(new Blob([serializeMarkdown({ ...activeNote, ...draft })], { type: "text/markdown;charset=utf-8" }), safeFilename(draft.title));
  }
  async function handleBackup() {
    await flushDraft(); const records = await listWorkspace();
    downloadBlob(await createBackup(records.notes, records.folders), `markgrove-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    const now = Date.now(); setLastBackup(now); await setSetting("lastBackup", now);
  }
  async function handleBackupFile(file: File | undefined) {
    if (!file) return;
    try {
      const ids = new Set([...notes.map((note) => note.id), ...folders.map((folder) => folder.id)]);
      setBackupPreview(await inspectBackup(file, ids));
    } catch { showToast(t("backupError")); }
    if (backupInputRef.current) backupInputRef.current.value = "";
  }
  async function confirmBackupRestore() {
    if (!backupPreview) return;
    await addImportedWorkspace(backupPreview.notes, backupPreview.folders); const count = backupPreview.notes.length;
    setBackupPreview(null); await reloadWorkspace(); showToast(t("importDone", { count }));
  }
  async function openHistory() {
    if (!selectedNoteId) return; await flushDraft(); setRevisions(await listRevisions(selectedNoteId)); setHistoryOpen(true);
  }
  async function handleRestoreRevision(revision: RevisionRecord) {
    const restored = await restoreRevision(revision); const next = asDraft(restored);
    draftRef.current = next; setDraft(next); setSelectedNoteId(restored.id); await reloadWorkspace(); setHistoryOpen(false);
  }
  async function changeView(next: ViewMode) { setViewMode(next); await setSetting("viewMode", next); }
  async function changeLanguage(next: Language) { setLanguage(next); await setSetting("language", next); }
  async function changeTheme(next: Theme) { setTheme(next); await setSetting("theme", next); }
  function changeExpanded(next: Set<string>) { setExpandedIds(next); void setSetting("expandedFolderIds", [...next]); }

  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX; const startWidth = sidebarWidth; let finalWidth = startWidth;
    const move = (moveEvent: PointerEvent) => { finalWidth = Math.max(240, Math.min(420, startWidth + moveEvent.clientX - startX)); setSidebarWidth(finalWidth); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); void setSetting("sidebarWidth", finalWidth); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  function navigationTitle(): string {
    if (navigation.kind === "folder") return folders.find((folder) => folder.id === navigation.folderId)?.name ?? t("folders");
    if (navigation.kind === "tag") return `#${navigation.tag}`;
    return t(navigation.kind === "inbox" ? "inbox" : navigation.kind === "recent" ? "recent" : navigation.kind === "favorites" ? "favorites" : navigation.kind === "trash" ? "trash" : "allNotes");
  }

  const moveItemRecord = moveTarget ? (moveTarget.kind === "note" ? notes.find((note) => note.id === moveTarget.id) : folders.find((folder) => folder.id === moveTarget.id)) : null;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block"><span className="brand-mark"><BookOpenText size={20} /></span><div><strong>MarkGrove</strong><small>{language === "zh" ? "本地 Markdown 笔记本" : "Local Markdown notebook"}</small></div></div>
        <div className="topbar-status">
          <span className={`save-state ${saveState}`}><Check size={14} />{t(saveState === "saving" ? "saving" : saveState === "failed" ? "saveFailed" : "saved")}</span>
          <span title={online ? t("online") : t("offline")}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}</span>
          <button type="button" className="icon-button" aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} onClick={() => { setSidebarCollapsed(!sidebarCollapsed); void setSetting("sidebarCollapsed", !sidebarCollapsed); }}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <button type="button" className="icon-button" aria-label={t("settings")} onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
        </div>
      </header>
      {updateApp && <div className="update-banner"><span>{t("updateReady")}</span><button type="button" onClick={updateApp}>{t("updateNow")}</button></div>}
      <main className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
        {!sidebarCollapsed && <>
          <aside className="library-sidebar">
            <div className="sidebar-actions">
              <button type="button" className="primary-action" onClick={() => void handleNewNote()}><Plus size={17} />{t("newNote")}</button>
              <details className="menu-details"><summary className="icon-button" aria-label={t("more")}><MoreHorizontal size={18} /></summary><div className="dropdown-menu" onClickCapture={(event) => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>
                <button type="button" onClick={() => void handleNewFolder()}><FolderPlus size={16} />{t("newFolder")}</button>
                <button type="button" onClick={() => markdownInputRef.current?.click()}><FileUp size={16} />{t("importMarkdown")}</button>
                <button type="button" onClick={() => void handleBackup()}><Download size={16} />{t("backup")}</button>
                <button type="button" onClick={() => backupInputRef.current?.click()}><Upload size={16} />{t("restoreBackup")}</button>
              </div></details>
            </div>
            <button type="button" className="quick-open-button" onClick={() => setQuickOpen(true)}><Search size={16} /><span>{language === "zh" ? "快速打开" : "Quick open"}</span><kbd>⌘K</kbd></button>
            <nav className="library-nav" aria-label={language === "zh" ? "资料库" : "Library"}>
              {([
                ["inbox", t("inbox"), notes.filter((note) => note.trashedAt === null && note.parentId === ROOT_FOLDER_ID).length],
                ["recent", t("recent"), null], ["favorites", t("favorites"), notes.filter((note) => note.trashedAt === null && note.pinned).length],
                ["all", t("allNotes"), notes.filter((note) => note.trashedAt === null && !hiddenFolders.has(note.parentId)).length],
              ] as const).map(([kind, label, count]) => <button type="button" key={kind} className={navigation.kind === kind ? "active" : ""} onClick={() => void navigate({ kind })}><FolderOpen size={15} />{label}{count !== null && <span>{count}</span>}</button>)}
            </nav>
            <div className="tree-section-head"><span>{t("folders")}</span><button type="button" aria-label={t("newFolder")} onClick={() => void handleNewFolder(ROOT_FOLDER_ID)}><Plus size={15} /></button></div>
            <WorkspaceTree
              folders={folders} notes={notes} expandedIds={expandedIds} selectedNoteId={selectedNoteId}
              selectedFolderId={!selectedNoteId && navigation.kind === "folder" ? navigation.folderId : null} language={language}
              onExpandedChange={changeExpanded} onOpenNote={(id) => void openNote(id)} onOpenFolder={(id) => void navigate({ kind: "folder", folderId: id })}
              onNewNote={(parentId) => void handleNewNote(parentId)} onNewFolder={(parentId) => void handleNewFolder(parentId)}
              onRename={requestRename} onMoveDialog={(kind, id) => setMoveTarget({ kind, id })} onMove={handleMove}
              onTrash={(kind, id) => void handleTrash(kind, id)} onDissolve={(id) => void handleDissolve(id)}
            />
            {tags.length > 0 && <details className="tag-section"><summary><Tag size={13} />{t("tags")}</summary><div className="tag-filter">{tags.map(({ tag, count }) => <button type="button" className={navigation.kind === "tag" && navigation.tag === tag ? "active" : ""} key={tag} onClick={() => void navigate({ kind: "tag", tag })}>#{tag}<span>{count}</span></button>)}</div></details>}
            <button type="button" className={`trash-nav ${navigation.kind === "trash" ? "active" : ""}`} onClick={() => void navigate({ kind: "trash" })}><Trash2 size={15} />{t("trash")}<span>{notes.filter((note) => note.trashedAt !== null).length + folders.filter((folder) => folder.trashedAt !== null && !hiddenFolders.has(folder.parentId)).length}</span></button>
            <div className="sidebar-foot"><HardDrive size={14} /><span>{t("localOnly")}</span><small>{lastBackup ? `${t("lastBackup")} ${dateLabel(lastBackup, language)}` : t("backupNever")}</small></div>
            <input ref={markdownInputRef} className="visually-hidden" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple onChange={(event) => void handleImport(event.target.files)} />
            <input ref={backupInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => void handleBackupFile(event.target.files?.[0])} />
          </aside>
          <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label={language === "zh" ? "调整侧栏宽度" : "Resize sidebar"} tabIndex={0} onPointerDown={startSidebarResize} onDoubleClick={() => { setSidebarWidth(304); void setSetting("sidebarWidth", 304); }} onKeyDown={(event) => {
            const delta = event.shiftKey ? 48 : 16;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const next = Math.max(240, Math.min(420, sidebarWidth + (event.key === "ArrowLeft" ? -delta : delta))); setSidebarWidth(next); void setSetting("sidebarWidth", next); }
            else if (event.key === "Home") { event.preventDefault(); setSidebarWidth(240); void setSetting("sidebarWidth", 240); }
            else if (event.key === "End") { event.preventDefault(); setSidebarWidth(420); void setSetting("sidebarWidth", 420); }
          }} />
        </>}

        {draft && activeNote ? <section className="note-workspace">
          <header className="note-toolbar">
            <div className="title-stack">
              <nav className="breadcrumbs" aria-label={language === "zh" ? "笔记位置" : "Note location"}><button type="button" onClick={() => void navigate({ kind: "inbox" })}>{language === "zh" ? "我的墨林" : "My grove"}</button>{breadcrumbs.map((folder) => <span key={folder.id}><ChevronRight size={12} /><button type="button" onClick={() => void navigate({ kind: "folder", folderId: folder.id })}>{folder.name}</button></span>)}</nav>
              <input ref={titleInputRef} className="note-title-input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} aria-label={language === "zh" ? "笔记标题" : "Note title"} />
              <label className="tag-input"><Tag size={13} /><input value={draft.tags.join(", ")} onChange={(event) => updateDraft({ tags: event.target.value.split(/[,，]/) })} placeholder={t("addTags")} /></label>
            </div>
            <div className="note-tools"><div className="view-switcher">{(["edit", "split", "preview"] as const).map((mode) => <button type="button" key={mode} className={viewMode === mode ? "active" : ""} onClick={() => void changeView(mode)}>{t(mode)}</button>)}</div>
              <details className="menu-details note-menu"><summary className="icon-button" aria-label={t("more")}><Menu size={18} /><ChevronDown size={12} /></summary><div className="dropdown-menu align-right" onClickCapture={(event) => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>
                <button type="button" onClick={() => void setPinned(activeNote.id, !activeNote.pinned).then(reloadWorkspace)}>{activeNote.pinned ? <PinOff size={16} /> : <Pin size={16} />}{t(activeNote.pinned ? "unpin" : "pin")}</button>
                <button type="button" onClick={async () => { await flushDraft(); const fresh = (await listWorkspace()).notes.find((note) => note.id === activeNote.id); if (fresh) { await duplicateNote(fresh, language === "zh" ? "副本" : "copy"); await reloadWorkspace(); } }}><FileDown size={16} />{t("duplicate")}</button>
                <button type="button" onClick={() => setMoveTarget({ kind: "note", id: activeNote.id })}>{t("moveTo")}</button>
                <button type="button" onClick={handleExportNote}><Download size={16} />{t("exportMarkdown")}</button>
                <button type="button" onClick={() => void openHistory()}><Clock3 size={16} />{t("history")}</button>
                <button type="button" className="danger" onClick={() => void handleTrash("note", activeNote.id)}><Trash2 size={16} />{t("moveToTrash")}</button>
              </div></details>
            </div>
          </header>
          <div className={`writing-area mode-${viewMode}`}>
            {viewMode !== "preview" && <section className="editor-pane" aria-label={t("edit")}><Suspense fallback={<div className="pane-loading">Markdown…</div>}><MarkdownEditor value={draft.content} onChange={(content) => updateDraft({ content })} theme={theme} label={language === "zh" ? "Markdown 编辑器" : "Markdown editor"} /></Suspense></section>}
            {viewMode !== "edit" && <section className="preview-pane" aria-label={t("preview")}><Suspense fallback={<div className="pane-loading">Preview…</div>}><MarkdownPreview content={draft.content} language={language} /></Suspense></section>}
          </div>
          <footer className="note-status"><span>Markdown · GFM</span><span>{countCharacters(draft.content)} {t("words")}</span><span>v{activeNote.revision}</span></footer>
        </section> : <LibraryOverview title={navigationTitle()} navigation={navigation} notes={overviewNotes} allNotes={notes} folders={folders} language={language} onOpenNote={(id) => void openNote(id)} onOpenFolder={(id) => void navigate({ kind: "folder", folderId: id })} onNewNote={() => void handleNewNote()} onRestoreNote={(id) => void restoreTrashedNote(id)} onRestoreFolder={(id) => void restoreTrashedFolder(id)} onDeleteNote={(id) => void deleteNote(id)} onDeleteFolder={(id) => void deleteFolder(id)} />}
      </main>

      {toast && <div className="undo-toast" role="status"><span>{toast.message}</span>{toast.undo && <button type="button" onClick={() => { if (toast.undo) runUndo(toast.undo); }}>{t("undo")}</button>}<button type="button" aria-label={t("close")} onClick={() => setToast(null)}>×</button></div>}
      {quickOpen && <QuickOpenDialog notes={notes} folders={folders} language={language} onClose={() => setQuickOpen(false)} onOpenNote={(id) => void openNote(id)} onOpenFolder={(id) => void navigate({ kind: "folder", folderId: id })} />}
      {moveTarget && moveItemRecord && <MoveDialog kind={moveTarget.kind} id={moveTarget.id} name={"title" in moveItemRecord ? moveItemRecord.title : moveItemRecord.name} notes={notes} folders={folders} language={language} onClose={() => setMoveTarget(null)} onMove={(parentId, targetIndex) => { const target = moveTarget; setMoveTarget(null); void handleMove({ ...target, parentId, targetIndex }); }} />}
      {renameTarget && <Modal title={t("rename")} closeLabel={t("close")} onClose={() => setRenameTarget(null)} footer={<><button type="button" onClick={() => setRenameTarget(null)}>{t("cancel")}</button><button type="button" className="primary" onClick={() => void confirmRename()}>{language === "zh" ? "保存" : "Save"}</button></>}><label className="rename-field"><span>{renameTarget.kind === "folder" ? t("folders") : t("newNote")}</span><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void confirmRename(); }} /></label></Modal>}
      {settingsOpen && <Modal title={t("settings")} closeLabel={t("close")} onClose={() => setSettingsOpen(false)}><div className="settings-grid">
        <section><h3><Languages size={17} />{t("language")}</h3><div className="segmented"><button type="button" className={language === "zh" ? "active" : ""} onClick={() => void changeLanguage("zh")}>中文</button><button type="button" className={language === "en" ? "active" : ""} onClick={() => void changeLanguage("en")}>English</button></div></section>
        <section><h3>{theme === "light" ? <Sun size={17} /> : <Moon size={17} />}{t("theme")}</h3><div className="segmented"><button type="button" className={theme === "light" ? "active" : ""} onClick={() => void changeTheme("light")}><Sun size={15} />Light</button><button type="button" className={theme === "dark" ? "active" : ""} onClick={() => void changeTheme("dark")}><Moon size={15} />Dark</button></div></section>
        <section className="storage-setting"><h3><HardDrive size={17} />{t("storage")}</h3><p>{t(persistent ? "storagePersistent" : "storageBestEffort")}</p>{!persistent && <button type="button" onClick={() => void requestPersistentStorage().then(setPersistent)}>{t("requestPersistence")}</button>}<small>{lastBackup ? `${t("lastBackup")}: ${dateLabel(lastBackup, language)}` : t("backupNever")}</small></section>
      </div></Modal>}
      {historyOpen && <Modal title={t("history")} closeLabel={t("close")} onClose={() => setHistoryOpen(false)}><div className="revision-list">{revisions.length === 0 ? <p>{t("revisionsEmpty")}</p> : revisions.map((revision) => <article key={revision.id}><div><strong>{revision.title}</strong><small>{dateLabel(revision.savedAt, language)} · v{revision.revision}</small><p>{revision.content.slice(0, 140) || "Markdown"}</p></div><button type="button" onClick={() => void handleRestoreRevision(revision)}><RotateCcw size={14} />{t("restoreRevision")}</button></article>)}</div></Modal>}
      {backupPreview && <Modal title={t("restoreBackup")} closeLabel={t("close")} onClose={() => setBackupPreview(null)} footer={<><button type="button" onClick={() => setBackupPreview(null)}>{t("cancel")}</button><button type="button" className="primary" onClick={() => void confirmBackupRestore()}>{t("confirmRestore")}</button></>}><div className="backup-preview"><ArchiveRestore size={30} /><p>{t("backupReady", { count: backupPreview.notes.length, conflicts: backupPreview.conflicts })}</p><small>{backupPreview.folders.length} {language === "zh" ? "个文件夹" : "folders"} · {backupPreview.exportedAt && new Date(backupPreview.exportedAt).toLocaleString()}</small></div></Modal>}
    </div>
  );
}
