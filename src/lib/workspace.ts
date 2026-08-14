import { ROOT_FOLDER_ID, type FolderRecord, type NoteRecord, type WorkspaceItemKind } from "../types";

export type NavigationTarget =
  | { kind: "inbox" }
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "favorites" }
  | { kind: "folder"; folderId: string }
  | { kind: "tag"; tag: string }
  | { kind: "trash" };

export interface TreeNode {
  id: string;
  kind: WorkspaceItemKind;
  parentId: string;
  orderKey: string;
  name: string;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  trashed: boolean;
}
export function trashedFolderIds(folders: FolderRecord[]): Set<string> {
  const result = new Set(folders.filter((folder) => folder.trashedAt !== null).map((folder) => folder.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export function flattenWorkspaceTree(
  folders: FolderRecord[],
  notes: NoteRecord[],
  expandedIds: Set<string>,
): TreeNode[] {
  const hiddenFolders = trashedFolderIds(folders);
  const folderChildren = new Map<string, FolderRecord[]>();
  const noteChildren = new Map<string, NoteRecord[]>();
  for (const folder of folders) {
    if (hiddenFolders.has(folder.id)) continue;
    const group = folderChildren.get(folder.parentId) ?? [];
    group.push(folder);
    folderChildren.set(folder.parentId, group);
  }
  for (const note of notes) {
    if (note.trashedAt !== null || hiddenFolders.has(note.parentId)) continue;
    const group = noteChildren.get(note.parentId) ?? [];
    group.push(note);
    noteChildren.set(note.parentId, group);
  }
  const result: TreeNode[] = [];
  const visit = (parentId: string, depth: number) => {
    const children = [
      ...(folderChildren.get(parentId) ?? []).map((folder) => ({
        id: folder.id, kind: "folder" as const, parentId: folder.parentId,
        orderKey: folder.orderKey, name: folder.name, source: folder,
      })),
      ...(noteChildren.get(parentId) ?? []).map((note) => ({
        id: note.id, kind: "note" as const, parentId: note.parentId,
        orderKey: note.orderKey, name: note.title, source: note,
      })),
    ].sort((left, right) => left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
    for (const child of children) {
      const isFolder = child.kind === "folder";
      const expanded = isFolder && expandedIds.has(child.id);
      result.push({
        id: child.id, kind: child.kind, parentId: child.parentId, orderKey: child.orderKey,
        name: child.name, depth, expanded,
        hasChildren: isFolder && Boolean((folderChildren.get(child.id)?.length ?? 0) + (noteChildren.get(child.id)?.length ?? 0)),
        trashed: false,
      });
      if (expanded) visit(child.id, depth + 1);
    }
  };
  visit(ROOT_FOLDER_ID, 0);
  return result;
}

export function visibleNotesForNavigation(
  notes: NoteRecord[],
  folders: FolderRecord[],
  navigation: NavigationTarget,
  query = "",
): NoteRecord[] {
  const hiddenFolders = trashedFolderIds(folders);
  const needle = query.trim().toLocaleLowerCase();
  const active = notes.filter((note) => note.trashedAt === null && !hiddenFolders.has(note.parentId));
  const scoped = navigation.kind === "trash"
    ? notes.filter((note) => note.trashedAt !== null)
    : active.filter((note) => {
      if (navigation.kind === "inbox") return note.parentId === ROOT_FOLDER_ID;
      if (navigation.kind === "folder") return note.parentId === navigation.folderId;
      if (navigation.kind === "favorites") return note.pinned;
      if (navigation.kind === "tag") return note.tags.includes(navigation.tag);
      return true;
    });
  return scoped
    .filter((note) => !needle || `${note.title}\n${note.content}\n${note.tags.join(" ")}`.toLocaleLowerCase().includes(needle))
    .sort((left, right) => {
      if (navigation.kind === "recent") return (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0) || right.updatedAt - left.updatedAt;
      if (navigation.kind === "folder" || navigation.kind === "inbox") return left.orderKey.localeCompare(right.orderKey);
      return Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt;
    });
}

export function folderBreadcrumbs(folderId: string, folders: FolderRecord[]): FolderRecord[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderRecord[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = byId.get(current.parentId);
  }
  return path;
}

export function countFolderContents(id: string, folders: FolderRecord[], notes: NoteRecord[]): { folders: number; notes: number } {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; }
    }
  }
  return { folders: Math.max(0, ids.size - 1), notes: notes.filter((note) => ids.has(note.parentId)).length };
}
