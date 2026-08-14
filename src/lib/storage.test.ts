import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteRecord } from "../types";
import { DATABASE_NAME, db, MarkGroveDatabase, createNote, listRevisions, queueDraftSave } from "./storage";

function legacyNote(): NoteRecord {
  return {
    id: "legacy-note", title: "Legacy", content: "preserve me", tags: ["old"], frontmatter: {},
    createdAt: 1, updatedAt: 2, revision: 3, snapshotAt: 0, pinned: false, trashedAt: null,
  };
}

describe("versioned local storage", () => {
  beforeEach(async () => {
    db.close();
    await Dexie.delete(DATABASE_NAME);
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await Dexie.delete(DATABASE_NAME);
  });

  it("upgrades a version 1 database without changing note content", async () => {
    const name = `markgrove-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({ notes: "id,updatedAt,trashedAt,pinned,*tags" });
    await legacy.open();
    await legacy.table<NoteRecord>("notes").add(legacyNote());
    legacy.close();

    const current = new MarkGroveDatabase(name);
    await current.open();
    expect((await current.notes.get("legacy-note"))?.content).toBe("preserve me");
    expect(current.tables.map((table) => table.name).sort()).toEqual(["notes", "revisions", "settings"]);
    current.close();
    await Dexie.delete(name);
  });

  it("serializes saves and keeps a recoverable first snapshot", async () => {
    const created = await createNote("Draft", "zero");
    await Promise.all([
      queueDraftSave({ id: created.id, title: "Draft", content: "one", tags: [] }),
      queueDraftSave({ id: created.id, title: "Draft", content: "two", tags: ["test"] }),
    ]);
    expect((await db.notes.get(created.id))?.content).toBe("two");
    const revisions = await listRevisions(created.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.content).toBe("zero");
  });
});
