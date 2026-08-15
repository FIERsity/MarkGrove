import Dexie, { type Table } from "dexie";
import {
  ROOT_FOLDER_ID,
  type FolderRecord,
  type ItemLocation,
  type NoteDraft,
  type NoteRecord,
  type RevisionRecord,
  type SettingRecord,
  type WorkspaceItemKind,
} from "../types";
import { initialOrderKey, orderKeyBetween } from "./order";

export const DATABASE_NAME = "markgrove";
export const MAX_REVISIONS_PER_NOTE = 20;
const SNAPSHOT_INTERVAL_MS = 60_000;

type WorkspaceSibling = {
  id: string;
  kind: WorkspaceItemKind;
  parentId: string;
  orderKey: string;
};

export interface DissolveSnapshot {
  folder: FolderRecord;
  children: ItemLocation[];
}

export class MarkGroveDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;
  folders!: Table<FolderRecord, string>;
  revisions!: Table<RevisionRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores({ notes: "id,updatedAt,trashedAt,pinned,*tags" });
    this.version(2).stores({
      notes: "id,updatedAt,trashedAt,pinned,*tags",
      revisions: "id,noteId,savedAt",
      settings: "key",
    });
    this.version(3).stores({
      notes: "id,parentId,[parentId+orderKey],updatedAt,trashedAt,pinned,lastOpenedAt,*tags",
      folders: "id,parentId,[parentId+orderKey],updatedAt,trashedAt",
      revisions: "id,noteId,savedAt",
      settings: "key",
    }).upgrade(async (transaction) => {
      const table = transaction.table<NoteRecord, string>("notes");
      const records = await table.toArray();
      records.sort((left, right) =>
        Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
        (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
        left.id.localeCompare(right.id),
      );
      await Promise.all(records.map((note, index) => table.update(note.id, {
        parentId: ROOT_FOLDER_ID,
        orderKey: initialOrderKey(index),
        lastOpenedAt: null,
      })));
    });
  }
}

export const db = new MarkGroveDatabase();
const writeQueues = new Map<string, Promise<NoteRecord>>();

function freshId(): string {
  return globalThis.crypto.randomUUID();
}

function sortSiblings<T extends { orderKey: string; id: string }>(items: T[]): T[] {
  return items.sort((left, right) => left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
}

async function siblings(parentId: string, includeTrashed = false): Promise<WorkspaceSibling[]> {
  const [notes, folders] = await Promise.all([
    db.notes.where("parentId").equals(parentId).toArray(),
    db.folders.where("parentId").equals(parentId).toArray(),
  ]);
  return sortSiblings([
    ...notes.filter((item) => includeTrashed || item.trashedAt === null)
      .map((item) => ({ id: item.id, kind: "note" as const, parentId, orderKey: item.orderKey })),
    ...folders.filter((item) => includeTrashed || item.trashedAt === null)
      .map((item) => ({ id: item.id, kind: "folder" as const, parentId, orderKey: item.orderKey })),
  ]);
}

async function appendOrderKey(parentId: string): Promise<string> {
  const current = await siblings(parentId);
  return orderKeyBetween(current.at(-1)?.orderKey, null) ?? initialOrderKey(current.length);
}

export async function createNote(
  title: string,
  content = "",
  tags: string[] = [],
  frontmatter: Record<string, unknown> = {},
  parentId = ROOT_FOLDER_ID,
): Promise<NoteRecord> {
  const now = Date.now();
  const note: NoteRecord = {
    id: freshId(), title, content, tags: normalizeTags(tags), frontmatter,
    createdAt: now, updatedAt: now, revision: 0, snapshotAt: 0, pinned: false,
    trashedAt: null, parentId, orderKey: await appendOrderKey(parentId), lastOpenedAt: now,
  };
  await db.notes.add(note);
  return note;
}

export async function createFolder(name: string, parentId = ROOT_FOLDER_ID): Promise<FolderRecord> {
  const now = Date.now();
  const folder: FolderRecord = {
    id: freshId(), parentId, name: name.trim() || "Untitled folder",
    orderKey: await appendOrderKey(parentId), createdAt: now, updatedAt: now, trashedAt: null,
  };
  await db.folders.add(folder);
  return folder;
}

export async function ensureStarterNote(title: string, content: string): Promise<NoteRecord> {
  return db.transaction("rw", db.notes, db.folders, async () => {
    const active = await db.notes.filter((note) => note.trashedAt === null).first();
    if (active) return active;
    return createNote(title, content);
  });
}

export async function listNotes(): Promise<NoteRecord[]> { return db.notes.toArray(); }
export async function listFolders(): Promise<FolderRecord[]> { return db.folders.toArray(); }
export async function listWorkspace(): Promise<{ notes: NoteRecord[]; folders: FolderRecord[] }> {
  const [notes, folders] = await Promise.all([listNotes(), listFolders()]);
  return { notes, folders };
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 20);
}

async function persistDraft(draft: NoteDraft): Promise<NoteRecord> {
  return db.transaction("rw", db.notes, db.revisions, async () => {
    const current = await db.notes.get(draft.id);
    if (!current) throw new Error("NOTE_NOT_FOUND");
    const tags = normalizeTags(draft.tags);
    const changed = current.title !== draft.title || current.content !== draft.content ||
      JSON.stringify(current.tags) !== JSON.stringify(tags);
    if (!changed) return current;

    const now = Date.now();
    let snapshotAt = current.snapshotAt;
    if (current.snapshotAt === 0 || now - current.snapshotAt >= SNAPSHOT_INTERVAL_MS) {
      await db.revisions.add({
        id: `${current.id}:${current.revision}:${now}`, noteId: current.id,
        revision: current.revision, title: current.title, content: current.content,
        tags: current.tags, savedAt: now,
      });
      snapshotAt = now;
      const revisions = await db.revisions.where("noteId").equals(current.id).sortBy("savedAt");
      const excess = revisions.slice(0, Math.max(0, revisions.length - MAX_REVISIONS_PER_NOTE));
      if (excess.length > 0) await db.revisions.bulkDelete(excess.map((revision) => revision.id));
    }

    const updated: NoteRecord = {
      ...current, title: draft.title.trim() || "Untitled note", content: draft.content, tags,
      updatedAt: now, revision: current.revision + 1, snapshotAt,
    };
    await db.notes.put(updated);
    return updated;
  });
}

export function queueDraftSave(draft: NoteDraft): Promise<NoteRecord> {
  const previous = writeQueues.get(draft.id);
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => persistDraft(draft));
  writeQueues.set(draft.id, next);
  void next.finally(() => { if (writeQueues.get(draft.id) === next) writeQueues.delete(draft.id); }).catch(() => undefined);
  return next;
}

export async function markNoteOpened(id: string): Promise<void> {
  await db.notes.update(id, { lastOpenedAt: Date.now() });
}

export async function duplicateNote(note: NoteRecord, suffix: string): Promise<NoteRecord> {
  return createNote(`${note.title} ${suffix}`.trim(), note.content, note.tags, note.frontmatter, note.parentId);
}

export async function setPinned(id: string, pinned: boolean): Promise<void> { await db.notes.update(id, { pinned }); }
export async function renameFolder(id: string, name: string): Promise<void> {
  await db.folders.update(id, { name: name.trim() || "Untitled folder", updatedAt: Date.now() });
}

export async function getItemLocation(kind: WorkspaceItemKind, id: string): Promise<ItemLocation> {
  const item = kind === "note" ? await db.notes.get(id) : await db.folders.get(id);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  return { kind, id, parentId: item.parentId, orderKey: item.orderKey };
}

function descendantFolderIds(folderId: string, folders: FolderRecord[]): Set<string> {
  const descendants = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const folder of folders) {
      if (folder.parentId === parent && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return descendants;
}

async function updateLocation(item: WorkspaceSibling, parentId: string, orderKey: string): Promise<void> {
  if (item.kind === "note") await db.notes.update(item.id, { parentId, orderKey });
  else await db.folders.update(item.id, { parentId, orderKey, updatedAt: Date.now() });
}

export async function moveItem(
  kind: WorkspaceItemKind,
  id: string,
  parentId: string,
  targetIndex: number,
): Promise<ItemLocation> {
  return db.transaction("rw", db.notes, db.folders, async () => {
    const original = await getItemLocation(kind, id);
    if (kind === "folder") {
      const folders = await db.folders.toArray();
      if (parentId === id || descendantFolderIds(id, folders).has(parentId)) throw new Error("INVALID_FOLDER_MOVE");
      if (parentId !== ROOT_FOLDER_ID && !folders.some((folder) => folder.id === parentId && folder.trashedAt === null)) {
        throw new Error("TARGET_NOT_FOUND");
      }
    }
    const destination = (await siblings(parentId)).filter((item) => !(item.kind === kind && item.id === id));
    const index = Math.max(0, Math.min(targetIndex, destination.length));
    let key = orderKeyBetween(destination[index - 1]?.orderKey, destination[index]?.orderKey);
    if (!key) {
      for (const [position, item] of destination.entries()) {
        item.orderKey = initialOrderKey(position);
        await updateLocation(item, parentId, item.orderKey);
      }
      key = orderKeyBetween(destination[index - 1]?.orderKey, destination[index]?.orderKey) ?? initialOrderKey(index);
    }
    await updateLocation({ kind, id, parentId: original.parentId, orderKey: original.orderKey }, parentId, key);
    return original;
  });
}

export async function restoreItemLocation(location: ItemLocation): Promise<void> {
  await db.transaction("rw", db.notes, db.folders, async () => {
    const parent = location.parentId === ROOT_FOLDER_ID ? true : await db.folders.get(location.parentId);
    const parentId = parent ? location.parentId : ROOT_FOLDER_ID;
    if (location.kind === "note") await db.notes.update(location.id, { parentId, orderKey: location.orderKey });
    else await db.folders.update(location.id, { parentId, orderKey: location.orderKey, updatedAt: Date.now() });
  });
}

export async function moveToTrash(id: string): Promise<void> {
  await db.notes.update(id, { trashedAt: Date.now(), pinned: false });
}
export async function restoreNote(id: string): Promise<void> {
  const note = await db.notes.get(id);
  if (!note) return;
  const parent = note.parentId === ROOT_FOLDER_ID ? null : await db.folders.get(note.parentId);
  await db.notes.update(id, { trashedAt: null, parentId: parent && parent.trashedAt === null ? note.parentId : ROOT_FOLDER_ID });
}
export async function trashFolder(id: string): Promise<void> { await db.folders.update(id, { trashedAt: Date.now() }); }
export async function restoreFolder(id: string): Promise<void> {
  const folder = await db.folders.get(id);
  if (!folder) return;
  const parent = folder.parentId === ROOT_FOLDER_ID ? null : await db.folders.get(folder.parentId);
  await db.folders.update(id, { trashedAt: null, parentId: parent && parent.trashedAt === null ? folder.parentId : ROOT_FOLDER_ID });
}

export async function dissolveFolder(id: string): Promise<DissolveSnapshot> {
  return db.transaction("rw", db.notes, db.folders, async () => {
    const folder = await db.folders.get(id);
    if (!folder) throw new Error("FOLDER_NOT_FOUND");
    const children = await siblings(id, true);
    const snapshot: DissolveSnapshot = {
      folder,
      children: children.map((item) => ({ kind: item.kind, id: item.id, parentId: item.parentId, orderKey: item.orderKey })),
    };
    const destination = (await siblings(folder.parentId, true)).filter((item) => !(item.kind === "folder" && item.id === id));
    const folderIndex = Math.max(0, (await siblings(folder.parentId, true)).findIndex((item) => item.kind === "folder" && item.id === id));
    destination.splice(folderIndex, 0, ...children);
    for (const [index, item] of destination.entries()) await updateLocation(item, folder.parentId, initialOrderKey(index));
    await db.folders.delete(id);
    return snapshot;
  });
}

export async function undoDissolveFolder(snapshot: DissolveSnapshot): Promise<void> {
  await db.transaction("rw", db.notes, db.folders, async () => {
    await db.folders.add(snapshot.folder);
    for (const child of snapshot.children) {
      if (child.kind === "note") await db.notes.update(child.id, { parentId: child.parentId, orderKey: child.orderKey });
      else await db.folders.update(child.id, { parentId: child.parentId, orderKey: child.orderKey });
    }
  });
}

export async function deleteNoteForever(id: string): Promise<void> {
  await db.transaction("rw", db.notes, db.revisions, async () => {
    await db.revisions.where("noteId").equals(id).delete();
    await db.notes.delete(id);
  });
}

export async function deleteFolderForever(id: string): Promise<{ folders: number; notes: number }> {
  return db.transaction("rw", db.notes, db.folders, db.revisions, async () => {
    const allFolders = await db.folders.toArray();
    const folderIds = descendantFolderIds(id, allFolders);
    folderIds.add(id);
    const notes = (await db.notes.toArray()).filter((note) => folderIds.has(note.parentId));
    if (notes.length > 0) {
      await db.revisions.where("noteId").anyOf(notes.map((note) => note.id)).delete();
      await db.notes.bulkDelete(notes.map((note) => note.id));
    }
    await db.folders.bulkDelete([...folderIds]);
    return { folders: folderIds.size, notes: notes.length };
  });
}

export async function listRevisions(noteId: string): Promise<RevisionRecord[]> {
  return (await db.revisions.where("noteId").equals(noteId).sortBy("savedAt")).reverse();
}
export async function restoreRevision(revision: RevisionRecord): Promise<NoteRecord> {
  return queueDraftSave({ id: revision.noteId, title: revision.title, content: revision.content, tags: revision.tags });
}

export async function addImportedWorkspace(
  notes: NoteRecord[],
  folders: FolderRecord[] = [],
): Promise<{ added: number; copied: number }> {
  return db.transaction("rw", db.notes, db.folders, async () => {
    const existingIds = new Set([
      ...(await db.notes.toCollection().primaryKeys()).map(String),
      ...(await db.folders.toCollection().primaryKeys()).map(String),
    ]);
    const remap = new Map<string, string>();
    for (const folder of folders) {
      if (existingIds.has(folder.id) || remap.has(folder.id)) remap.set(folder.id, freshId());
      existingIds.add(remap.get(folder.id) ?? folder.id);
    }
    let copied = 0;
    const importedFolders = folders.map((folder) => ({
      ...folder,
      id: remap.get(folder.id) ?? folder.id,
      parentId: remap.get(folder.parentId) ?? folder.parentId,
    }));
    const importedNotes = notes.map((note) => {
      const collision = existingIds.has(note.id);
      if (collision) copied += 1;
      const id = collision ? freshId() : note.id;
      existingIds.add(id);
      return {
        ...note, id,
        parentId: remap.get(note.parentId) ?? note.parentId,
        title: collision ? `${note.title} (imported)` : note.title,
      };
    });
    const existingRoot = await siblings(ROOT_FOLDER_ID, true);
    let lastRootKey = existingRoot.at(-1)?.orderKey ?? null;
    const importedRoot = [
      ...importedFolders.filter((item) => item.parentId === ROOT_FOLDER_ID).map((item) => ({ source: item, orderKey: item.orderKey })),
      ...importedNotes.filter((item) => item.parentId === ROOT_FOLDER_ID).map((item) => ({ source: item, orderKey: item.orderKey })),
    ].sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    for (const item of importedRoot) {
      const nextKey = orderKeyBetween(lastRootKey, null) ?? initialOrderKey(existingRoot.length + 1);
      item.source.orderKey = nextKey;
      lastRootKey = nextKey;
    }
    if (importedFolders.length > 0) await db.folders.bulkAdd(importedFolders);
    if (importedNotes.length > 0) await db.notes.bulkAdd(importedNotes);
    return { added: importedNotes.length, copied };
  });
}

export async function addImportedNotes(notes: NoteRecord[]): Promise<{ added: number; copied: number }> {
  return addImportedWorkspace(notes, []);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const setting = await db.settings.get(key);
  return setting ? setting.value as T : fallback;
}
export async function setSetting(key: string, value: unknown): Promise<void> { await db.settings.put({ key, value }); }
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
export async function isStoragePersistent(): Promise<boolean> {
  return navigator.storage?.persisted ? navigator.storage.persisted() : false;
}

export interface StorageEstimate {
  usage: number | null;
  quota: number | null;
}

export async function estimateStorage(): Promise<StorageEstimate> {
  if (!navigator.storage?.estimate) return { usage: null, quota: null };
  const estimate = await navigator.storage.estimate();
  return {
    usage: typeof estimate.usage === "number" ? estimate.usage : null,
    quota: typeof estimate.quota === "number" ? estimate.quota : null,
  };
}
