import { useEffect, useMemo, useState } from "react";
import { FileText, Folder, Search } from "lucide-react";
import type { FolderRecord, Language, NoteRecord } from "../types";
import { folderBreadcrumbs } from "../lib/workspace";
import { Modal } from "./Modal";

interface Props {
  notes: NoteRecord[];
  folders: FolderRecord[];
  language: Language;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onOpenFolder: (id: string) => void;
}

type Result = { id: string; kind: "note" | "folder"; name: string; path: string; score: number };

export function QuickOpenDialog(props: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    const noteResults = props.notes.filter((note) => note.trashedAt === null).map((note) => {
      const haystack = `${note.title}\n${note.content}\n${note.tags.join(" ")}`.toLocaleLowerCase();
      const title = note.title.toLocaleLowerCase();
      const score = !needle ? (note.lastOpenedAt ?? note.updatedAt) : title === needle ? 3 : title.includes(needle) ? 2 : haystack.includes(needle) ? 1 : 0;
      return { id: note.id, kind: "note" as const, name: note.title, path: folderBreadcrumbs(note.parentId, props.folders).map((folder) => folder.name).join(" / "), score };
    });
    const folderResults = props.folders.filter((folder) => folder.trashedAt === null).map((folder) => {
      const fullPath = folderBreadcrumbs(folder.id, props.folders).map((item) => item.name);
      const score = !needle ? 0 : folder.name.toLocaleLowerCase() === needle ? 3 : fullPath.join(" / ").toLocaleLowerCase().includes(needle) ? 2 : 0;
      return {
        id: folder.id,
        kind: "folder" as const,
        name: folder.name,
        path: fullPath.slice(0, -1).join(" / ") || (props.language === "zh" ? "我的墨林" : "My Grove"),
        score,
      };
    });
    return [...noteResults, ...folderResults].filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)).slice(0, 30);
  }, [props.folders, props.language, props.notes, query]);

  useEffect(() => { setActive(0); }, [query]);
  function open(result: Result | undefined) {
    if (!result) return;
    if (result.kind === "note") props.onOpenNote(result.id); else props.onOpenFolder(result.id);
    props.onClose();
  }

  return (
    <Modal title={props.language === "zh" ? "快速打开" : "Quick open"} closeLabel={props.language === "zh" ? "关闭" : "Close"} onClose={props.onClose}>
      <label className="dialog-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={props.language === "zh" ? "搜索笔记、正文或文件夹" : "Search notes, text, or folders"} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
        else if (event.key === "Enter") { event.preventDefault(); open(results[active]); }
      }} /></label>
      <div className="quick-results" role="listbox">
        {results.map((result, index) => <button type="button" role="option" aria-selected={index === active} className={index === active ? "active" : ""} key={`${result.kind}:${result.id}`} onMouseEnter={() => setActive(index)} onClick={() => open(result)}>
          {result.kind === "folder" ? <Folder size={17} /> : <FileText size={17} />}
          <span><strong>{result.name}</strong><small>{result.path || (props.language === "zh" ? "Inbox" : "Inbox")}</small></span>
        </button>)}
        {results.length === 0 && <p>{props.language === "zh" ? "没有匹配结果" : "No matching results"}</p>}
      </div>
    </Modal>
  );
}
