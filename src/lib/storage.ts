import Dexie, { type Table } from "dexie";
import type { NoteDraft, NoteRecord, RevisionRecord, SettingRecord } from "../types";

export const DATABASE_NAME = "markgrove";
export const MAX_REVISIONS_PER_NOTE = 20;
const SNAPSHOT_INTERVAL_MS = 60_000;

export class MarkGroveDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;
  revisions!: Table<RevisionRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      notes: "id,updatedAt,trashedAt,pinned,*tags",
    });
    this.version(2).stores({
      notes: "id,updatedAt,trashedAt,pinned,*tags",
      revisions: "id,noteId,savedAt",
      settings: "key",
    });
  }
}

export const db = new MarkGroveDatabase();

const writeQueues = new Map<string, Promise<NoteRecord>>();

function freshId(): string {
  return globalThis.crypto.randomUUID();
}

export async function createNote(
  title: string,
  content = "",
  tags: string[] = [],
  frontmatter: Record<string, unknown> = {},
): Promise<NoteRecord> {
  const now = Date.now();
  const note: NoteRecord = {
    id: freshId(),
    title,
    content,
    tags: normalizeTags(tags),
    frontmatter,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    snapshotAt: 0,
    pinned: false,
    trashedAt: null,
  };
  await db.notes.add(note);
  return note;
}

export async function ensureStarterNote(title: string, content: string): Promise<NoteRecord> {
  return db.transaction("rw", db.notes, async () => {
    const active = await db.notes.filter((note) => note.trashedAt === null).first();
    if (active) return active;
    const now = Date.now();
    const note: NoteRecord = {
      id: freshId(), title, content, tags: [], frontmatter: {}, createdAt: now, updatedAt: now,
      revision: 0, snapshotAt: 0, pinned: false, trashedAt: null,
    };
    await db.notes.add(note);
    return note;
  });
}

export async function listNotes(): Promise<NoteRecord[]> {
  return db.notes.toArray();
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
        id: `${current.id}:${current.revision}:${now}`,
        noteId: current.id,
        revision: current.revision,
        title: current.title,
        content: current.content,
        tags: current.tags,
        savedAt: now,
      });
      snapshotAt = now;

      const revisions = await db.revisions.where("noteId").equals(current.id).sortBy("savedAt");
      const excess = revisions.slice(0, Math.max(0, revisions.length - MAX_REVISIONS_PER_NOTE));
      if (excess.length > 0) await db.revisions.bulkDelete(excess.map((revision) => revision.id));
    }

    const updated: NoteRecord = {
      ...current,
      title: draft.title.trim() || "Untitled note",
      content: draft.content,
      tags,
      updatedAt: now,
      revision: current.revision + 1,
      snapshotAt,
    };
    await db.notes.put(updated);
    return updated;
  });
}

export function queueDraftSave(draft: NoteDraft): Promise<NoteRecord> {
  const previous = writeQueues.get(draft.id);
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve())
    .then(() => persistDraft(draft));
  writeQueues.set(draft.id, next);
  void next.finally(() => {
    if (writeQueues.get(draft.id) === next) writeQueues.delete(draft.id);
  }).catch(() => undefined);
  return next;
}

export async function duplicateNote(note: NoteRecord, suffix: string): Promise<NoteRecord> {
  return createNote(`${note.title} ${suffix}`.trim(), note.content, note.tags, note.frontmatter);
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  await db.notes.update(id, { pinned, updatedAt: Date.now() });
}

export async function moveToTrash(id: string): Promise<void> {
  await db.notes.update(id, { trashedAt: Date.now(), pinned: false, updatedAt: Date.now() });
}

export async function restoreNote(id: string): Promise<void> {
  await db.notes.update(id, { trashedAt: null, updatedAt: Date.now() });
}

export async function deleteNoteForever(id: string): Promise<void> {
  await db.transaction("rw", db.notes, db.revisions, async () => {
    await db.revisions.where("noteId").equals(id).delete();
    await db.notes.delete(id);
  });
}

export async function listRevisions(noteId: string): Promise<RevisionRecord[]> {
  const revisions = await db.revisions.where("noteId").equals(noteId).sortBy("savedAt");
  return revisions.reverse();
}

export async function restoreRevision(revision: RevisionRecord): Promise<NoteRecord> {
  return queueDraftSave({
    id: revision.noteId,
    title: revision.title,
    content: revision.content,
    tags: revision.tags,
  });
}

export async function addImportedNotes(notes: NoteRecord[]): Promise<{ added: number; copied: number }> {
  let copied = 0;
  const records: NoteRecord[] = [];
  for (const note of notes) {
    const collision = await db.notes.get(note.id);
    if (collision) copied += 1;
    records.push({
      ...note,
      id: collision ? freshId() : note.id,
      title: collision ? `${note.title} (imported)` : note.title,
    });
  }
  await db.notes.bulkAdd(records);
  return { added: records.length, copied };
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const setting = await db.settings.get(key);
  return setting ? setting.value as T : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function isStoragePersistent(): Promise<boolean> {
  return navigator.storage?.persisted ? navigator.storage.persisted() : false;
}
