import { describe, expect, it } from "vitest";
import { ROOT_FOLDER_ID, type FolderRecord, type NoteRecord } from "../types";
import { createBackup, inspectBackup } from "./backup";
import { serializeMarkdown } from "./markdown";

function note(id: string, title: string, parentId = ROOT_FOLDER_ID): NoteRecord {
  return {
    id, title, content: `# ${title}\n\nPrivate body`, tags: ["portable"], frontmatter: { author: "Me" },
    createdAt: 10, updatedAt: 20, revision: 2, snapshotAt: 15, pinned: true, trashedAt: null,
    parentId, orderKey: "00000000000001000000", lastOpenedAt: 18,
  };
}

function folder(id: string, parentId = ROOT_FOLDER_ID): FolderRecord {
  return { id, parentId, name: `Folder ${id}`, orderKey: "00000000000001000000", createdAt: 2, updatedAt: 3, trashedAt: null };
}

describe("versioned backup", () => {
  it("round-trips folders and standard Markdown notes while reporting ID conflicts", async () => {
    const parent = folder("folder-one");
    const child = folder("folder-two", parent.id);
    const source = note("12345678-abcd-4abc-8abc-123456789abc", "Field / notes", child.id);
    const blob = await createBackup([source], [parent, child]);
    const preview = await inspectBackup(blob, new Set([source.id]));
    expect(preview.conflicts).toBe(1);
    expect(preview.folders).toEqual([parent, child]);
    expect(preview.notes[0]).toMatchObject({
      id: source.id, title: source.title, content: source.content, tags: source.tags,
      pinned: true, parentId: child.id, orderKey: source.orderKey, lastOpenedAt: 18,
    });
  });

  it("reads a real v1 manifest into Inbox with deterministic order", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const source = note("legacy-note", "Legacy");
    zip.file("notes/legacy.md", serializeMarkdown(source));
    zip.file("manifest.json", JSON.stringify({
      format: "markgrove-backup", version: 1, exportedAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: source.id, file: "notes/legacy.md", createdAt: 10, updatedAt: 20, revision: 2, snapshotAt: 15, pinned: true, trashedAt: null }],
    }));
    const preview = await inspectBackup(await zip.generateAsync({ type: "blob" }), new Set());
    expect(preview.folders).toEqual([]);
    expect(preview.notes[0]).toMatchObject({ parentId: ROOT_FOLDER_ID, orderKey: "00000000000001000000", lastOpenedAt: null });
  });

  it("rejects a ZIP without a MarkGrove manifest", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip(); zip.file("notes/random.md", "# No manifest");
    await expect(inspectBackup(await zip.generateAsync({ type: "blob" }), new Set())).rejects.toThrow("MISSING_MANIFEST");
  });

  it("rejects folder cycles before importing any data", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      format: "markgrove-backup", version: 2, exportedAt: "", notes: [],
      folders: [folder("a", "b"), folder("b", "a")],
    }));
    await expect(inspectBackup(await zip.generateAsync({ type: "blob" }), new Set())).rejects.toThrow("FOLDER_CYCLE");
  });
});
