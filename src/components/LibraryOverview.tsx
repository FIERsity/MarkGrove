import { ArchiveRestore, FileText, Folder, Plus, Trash2 } from "lucide-react";
import type { FolderRecord, Language, NoteRecord } from "../types";
import { countFolderContents, type NavigationTarget } from "../lib/workspace";

interface Props {
  title: string;
  navigation: NavigationTarget;
  notes: NoteRecord[];
  allNotes: NoteRecord[];
  folders: FolderRecord[];
  language: Language;
  onOpenNote: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onNewNote: () => void;
  onRestoreNote: (id: string) => void;
  onRestoreFolder: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onDeleteFolder: (id: string) => void;
}

export function LibraryOverview(props: Props) {
  const trashedFolders = props.navigation.kind === "trash"
    ? props.folders.filter((folder) => folder.trashedAt !== null && !props.folders.some((parent) => parent.id === folder.parentId && parent.trashedAt !== null))
    : [];
  return (
    <section className="library-overview">
      <header><div><span>{props.language === "zh" ? "资料库" : "Library"}</span><h1>{props.title}</h1></div>{props.navigation.kind !== "trash" && <button type="button" className="primary-action compact" onClick={props.onNewNote}><Plus size={16} />{props.language === "zh" ? "新建笔记" : "New note"}</button>}</header>
      <div className="overview-grid">
        {trashedFolders.map((folder) => {
          const count = countFolderContents(folder.id, props.folders, props.allNotes);
          return <article className="overview-card folder-card" key={folder.id}>
            <div className="overview-open static"><Folder size={19} /><span><strong>{folder.name}</strong><small>{count.folders} {props.language === "zh" ? "个文件夹" : "folders"} · {count.notes} {props.language === "zh" ? "篇笔记" : "notes"}</small></span></div>
            <div><button type="button" onClick={() => props.onRestoreFolder(folder.id)}><ArchiveRestore size={15} />{props.language === "zh" ? "恢复" : "Restore"}</button><button type="button" className="danger" onClick={() => props.onDeleteFolder(folder.id)}><Trash2 size={15} />{props.language === "zh" ? "永久删除" : "Delete"}</button></div>
          </article>;
        })}
        {props.notes.map((note) => <article className="overview-card" key={note.id}>
          <button type="button" className="overview-open" onClick={() => props.onOpenNote(note.id)}><FileText size={18} /><span><strong>{note.title}</strong><small>{note.content.replace(/[#>*_`\-[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Markdown"}</small></span></button>
          {props.navigation.kind === "trash" && <div><button type="button" onClick={() => props.onRestoreNote(note.id)}><ArchiveRestore size={15} />{props.language === "zh" ? "恢复" : "Restore"}</button><button type="button" className="danger" onClick={() => props.onDeleteNote(note.id)}><Trash2 size={15} />{props.language === "zh" ? "永久删除" : "Delete"}</button></div>}
        </article>)}
      </div>
      {props.notes.length === 0 && trashedFolders.length === 0 && <div className="overview-empty"><Folder size={34} /><p>{props.language === "zh" ? "这里还没有内容" : "Nothing here yet"}</p>{props.navigation.kind !== "trash" && <button type="button" onClick={props.onNewNote}><Plus size={15} />{props.language === "zh" ? "写第一篇笔记" : "Write the first note"}</button>}</div>}
    </section>
  );
}
