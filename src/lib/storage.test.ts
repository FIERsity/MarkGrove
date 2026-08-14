import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROOT_FOLDER_ID, type FolderRecord, type NoteRecord, type RevisionRecord } from "../types";
import {
  DATABASE_NAME, MarkGroveDatabase, addImportedWorkspace, createFolder, createNote, db,
  dissolveFolder, listRevisions, moveItem, queueDraftSave, restoreItemLocation,
  undoDissolveFolder,
} from "./storage";

type LegacyNote = Omit<NoteRecord, "parentId" | "orderKey" | "lastOpenedAt">;
function legacyNote(id = "legacy-note"): LegacyNote {
  return {
    id, title: "Legacy", content: "preserve me", tags: ["old"], frontmatter: { source: "v2" },
    createdAt: 1, updatedAt: 2, revision: 3, snapshotAt: 0, pinned: false, trashedAt: null,
  };
}

describe("versioned local storage", () => {
  beforeEach(async () => { db.close(); await Dexie.delete(DATABASE_NAME); await db.open(); });
  afterEach(async () => { db.close(); await Dexie.delete(DATABASE_NAME); });

  it("upgrades a version 1 database to v3 without changing note content", async () => {
    const name = `markgrove-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name); legacy.version(1).stores({ notes: "id,updatedAt,trashedAt,pinned,*tags" });
    await legacy.open(); await legacy.table<LegacyNote>("notes").add(legacyNote()); legacy.close();
    const current = new MarkGroveDatabase(name); await current.open();
    expect(await current.notes.get("legacy-note")).toMatchObject({ content: "preserve me", parentId: ROOT_FOLDER_ID, orderKey: "00000000000001000000", lastOpenedAt: null });
    expect(current.tables.map((table) => table.name).sort()).toEqual(["folders", "notes", "revisions", "settings"]);
    current.close(); await Dexie.delete(name);
  });

  it("preserves v2 revisions and deterministically orders old notes", async () => {
    const name = `markgrove-v2-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({ notes: "id,updatedAt,trashedAt,pinned,*tags", revisions: "id,noteId,savedAt", settings: "key" });
    await legacy.open();
    await legacy.table<LegacyNote>("notes").bulkAdd([
      { ...legacyNote("later"), updatedAt: 20 }, { ...legacyNote("pin"), updatedAt: 1, pinned: true }, { ...legacyNote("earlier"), updatedAt: 10 },
    ]);
    const revision: RevisionRecord = { id: "r1", noteId: "later", revision: 0, title: "Old", content: "old", tags: [], savedAt: 3 };
    await legacy.table<RevisionRecord>("revisions").add(revision); legacy.close();
    const current = new MarkGroveDatabase(name); await current.open();
    const records = (await current.notes.toArray()).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    expect(records.map((item) => item.id)).toEqual(["pin", "later", "earlier"]);
    expect(await current.revisions.get("r1")).toEqual(revision);
    current.close(); await Dexie.delete(name);
  });

  it("serializes saves and keeps a recoverable first snapshot", async () => {
    const created = await createNote("Draft", "zero");
    await Promise.all([
      queueDraftSave({ id: created.id, title: "Draft", content: "one", tags: [] }),
      queueDraftSave({ id: created.id, title: "Draft", content: "two", tags: ["test"] }),
    ]);
    expect((await db.notes.get(created.id))?.content).toBe("two");
    const revisions = await listRevisions(created.id);
    expect(revisions).toHaveLength(1); expect(revisions[0]?.content).toBe("zero");
  });

  it("moves notes atomically and restores their prior location", async () => {
    const folder = await createFolder("Work"); const note = await createNote("Move me");
    const original = await moveItem("note", note.id, folder.id, 0);
    expect((await db.notes.get(note.id))?.parentId).toBe(folder.id);
    await restoreItemLocation(original);
    expect((await db.notes.get(note.id))?.parentId).toBe(ROOT_FOLDER_ID);
  });

  it("rejects moving a folder into one of its descendants", async () => {
    const parent = await createFolder("Parent");
    const child = await createFolder("Child", parent.id);
    await expect(moveItem("folder", parent.id, child.id, 0)).rejects.toThrow("INVALID_FOLDER_MOVE");
    expect((await db.folders.get(parent.id))?.parentId).toBe(ROOT_FOLDER_ID);
  });

  it("dissolves a folder in place and restores its exact children on undo", async () => {
    const folder = await createFolder("Temporary");
    const note = await createNote("Inside", "", [], {}, folder.id);
    const child = await createFolder("Nested", folder.id);
    const originalNoteKey = note.orderKey;
    const originalChildKey = child.orderKey;
    const snapshot = await dissolveFolder(folder.id);
    expect(await db.folders.get(folder.id)).toBeUndefined();
    expect((await db.notes.get(note.id))?.parentId).toBe(ROOT_FOLDER_ID);
    expect((await db.folders.get(child.id))?.parentId).toBe(ROOT_FOLDER_ID);

    await undoDissolveFolder(snapshot);
    expect((await db.notes.get(note.id))).toMatchObject({ parentId: folder.id, orderKey: originalNoteKey });
    expect((await db.folders.get(child.id))).toMatchObject({ parentId: folder.id, orderKey: originalChildKey });
  });

  it("remaps imported folder collisions and appends the imported root block", async () => {
    const existing = await createFolder("Existing");
    const now = Date.now();
    const importedFolder: FolderRecord = {
      id: existing.id, parentId: ROOT_FOLDER_ID, name: "Imported folder",
      orderKey: "00000000000000000001", createdAt: now, updatedAt: now, trashedAt: null,
    };
    const importedNote: NoteRecord = {
      ...legacyNote("imported-note"), parentId: existing.id,
      orderKey: "00000000000000000001", lastOpenedAt: null,
    };
    const rootNote: NoteRecord = {
      ...legacyNote("root-note"), parentId: ROOT_FOLDER_ID,
      orderKey: "00000000000000000000", lastOpenedAt: null,
    };

    await addImportedWorkspace([rootNote, importedNote], [importedFolder]);
    const imported = (await db.folders.toArray()).find((folder) => folder.name === "Imported folder");
    expect(imported?.id).not.toBe(existing.id);
    expect((await db.notes.get("imported-note"))?.parentId).toBe(imported?.id);
    expect((await db.notes.get("root-note"))!.orderKey > existing.orderKey).toBe(true);
    expect(imported!.orderKey > existing.orderKey).toBe(true);
  });
});
