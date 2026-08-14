import { useMemo, useState } from "react";
import { Folder, Search } from "lucide-react";
import { ROOT_FOLDER_ID, type FolderRecord, type Language, type NoteRecord, type WorkspaceItemKind } from "../types";
import { folderBreadcrumbs } from "../lib/workspace";
import { Modal } from "./Modal";

interface Props {
  kind: WorkspaceItemKind;
  id: string;
  name: string;
  folders: FolderRecord[];
  notes: NoteRecord[];
  language: Language;
  onClose: () => void;
  onMove: (parentId: string, targetIndex: number) => void;
}

function isInvalidTarget(candidateId: string, sourceId: string, folders: FolderRecord[]): boolean {
  if (candidateId === sourceId) return true;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(candidateId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.parentId === sourceId) return true;
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
}

export function MoveDialog(props: Props) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState(ROOT_FOLDER_ID);
  const [placement, setPlacement] = useState("end");
  const choices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return props.folders
      .filter((folder) => folder.trashedAt === null)
      .filter((folder) => props.kind !== "folder" || !isInvalidTarget(folder.id, props.id, props.folders))
      .map((folder) => ({ folder, path: folderBreadcrumbs(folder.id, props.folders).map((item) => item.name).join(" / ") }))
      .filter((item) => !needle || item.path.toLocaleLowerCase().includes(needle))
      .sort((left, right) => left.path.localeCompare(right.path));
  }, [props.folders, props.id, props.kind, query]);

  const targetChildren = [
    ...props.folders.filter((item) => item.parentId === target && item.trashedAt === null && !(props.kind === "folder" && item.id === props.id)).map((item) => ({ id: item.id, kind: "folder" as const, name: item.name, orderKey: item.orderKey })),
    ...props.notes.filter((item) => item.parentId === target && item.trashedAt === null && !(props.kind === "note" && item.id === props.id)).map((item) => ({ id: item.id, kind: "note" as const, name: item.title, orderKey: item.orderKey })),
  ].sort((left, right) => left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
  const [placementKind, placementIndex] = placement.split(":");
  const chosenIndex = placementKind === "end" ? targetChildren.length : Math.max(0, Number(placementIndex) + (placementKind === "after" ? 1 : 0));

  return (
    <Modal
      title={`${props.language === "zh" ? "移动" : "Move"} “${props.name}”`}
      closeLabel={props.language === "zh" ? "关闭" : "Close"}
      onClose={props.onClose}
      footer={<>
        <button type="button" onClick={props.onClose}>{props.language === "zh" ? "取消" : "Cancel"}</button>
        <button type="button" className="primary" onClick={() => props.onMove(target, chosenIndex)}>{props.language === "zh" ? "移动到这里" : "Move here"}</button>
      </>}
    >
      <label className="dialog-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={props.language === "zh" ? "搜索文件夹路径" : "Search folder paths"} /></label>
      <div className="folder-picker" role="listbox" aria-label={props.language === "zh" ? "目标文件夹" : "Destination folder"}>
        <button type="button" role="option" aria-selected={target === ROOT_FOLDER_ID} className={target === ROOT_FOLDER_ID ? "active" : ""} onClick={() => { setTarget(ROOT_FOLDER_ID); setPlacement("end"); }}><Folder size={16} />{props.language === "zh" ? "我的墨林 / Inbox" : "My grove / Inbox"}</button>
        {choices.map(({ folder, path }) => <button type="button" role="option" aria-selected={target === folder.id} className={target === folder.id ? "active" : ""} key={folder.id} onClick={() => { setTarget(folder.id); setPlacement("end"); }}><Folder size={16} /><span>{path}</span></button>)}
      </div>
      <label className="placement-field"><span>{props.language === "zh" ? "在目标中的位置" : "Position in destination"}</span><select value={placement} onChange={(event) => setPlacement(event.target.value)}>
        <option value="end">{props.language === "zh" ? "放在末尾" : "At the end"}</option>
        {targetChildren.flatMap((item, index) => [
          <option key={`before:${item.kind}:${item.id}`} value={`before:${index}`}>{props.language === "zh" ? `放在“${item.name}”之前` : `Before “${item.name}”`}</option>,
          <option key={`after:${item.kind}:${item.id}`} value={`after:${index}`}>{props.language === "zh" ? `放在“${item.name}”之后` : `After “${item.name}”`}</option>,
        ])}
      </select></label>
    </Modal>
  );
}
