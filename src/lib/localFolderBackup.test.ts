import { describe, expect, it } from "vitest";
import {
  buildLocalFolderManifest, LOCAL_FOLDER_FORMAT, LOCAL_FOLDER_VERSION, mirrorWorkspaceToLocalFolder,
  readLocalFolderPreview,
} from "./localFolderBackup";
import { ROOT_FOLDER_ID, type FolderRecord, type NoteRecord } from "../types";

function folder(id: string, name: string, parentId = ROOT_FOLDER_ID): FolderRecord {
  return { id, name, parentId, orderKey: id, createdAt: 1, updatedAt: 1, trashedAt: null };
}

function note(id: string, title: string, parentId = ROOT_FOLDER_ID): NoteRecord {
  return {
    id, title, parentId, content: "text", tags: [], frontmatter: {}, orderKey: id,
    createdAt: 1, updatedAt: 1, revision: 0, snapshotAt: 0, pinned: false, trashedAt: null, lastOpenedAt: null,
  };
}

class MemoryDirectory {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, string>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const created = new MemoryDirectory(); this.directories.set(name, created); return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) throw new DOMException("Not found", "NotFoundError");
    if (!this.files.has(name)) this.files.set(name, "");
    return {
      getFile: async () => new File([this.files.get(name)!], name),
      createWritable: async () => ({
        write: async (source: string) => { this.files.set(name, source); },
        close: async () => undefined,
      }),
    };
  }
}

describe("local folder backup manifest", () => {
  it("keeps a readable, stable folder hierarchy and unique note names", () => {
    const parent = folder("parent-12345678", "Projects");
    const child = folder("child-12345678", "2026", parent.id);
    const manifest = buildLocalFolderManifest([
      note("one-12345678", "Plan", child.id),
      note("two-12345678", "Plan", child.id),
    ], [parent, child], "2026-08-15T00:00:00.000Z");

    expect(manifest.format).toBe(LOCAL_FOLDER_FORMAT);
    expect(manifest.version).toBe(LOCAL_FOLDER_VERSION);
    expect(manifest.notes.map((entry) => entry.path)).toEqual([
      "notes/Projects--parent-1/2026--child-12/Plan--one-1234.md",
      "notes/Projects--parent-1/2026--child-12/Plan--two-1234.md",
    ]);
  });

  it("rejects a manifest that tries to read outside the notes directory", async () => {
    const root = {
      getDirectoryHandle: async () => ({
        getFileHandle: async () => ({ getFile: async () => new File([JSON.stringify({
          format: LOCAL_FOLDER_FORMAT, version: LOCAL_FOLDER_VERSION, exportedAt: "", folders: [], notes: [{
            id: "note", path: "notes/../secret.md", parentId: ROOT_FOLDER_ID, orderKey: "a", createdAt: 0, updatedAt: 0,
            revision: 0, snapshotAt: 0, pinned: false, trashedAt: null, lastOpenedAt: null,
          }],
        })], "manifest.json") }),
      }),
    } as unknown as FileSystemDirectoryHandle;
    await expect(readLocalFolderPreview(root)).rejects.toThrow("INVALID_LOCAL_FOLDER_MANIFEST");
  });

  it("writes and restores Markdown with its folder structure", async () => {
    const root = new MemoryDirectory();
    const parent = folder("parent-12345678", "Projects");
    const source = { ...note("one-12345678", "Plan", parent.id), content: "# Plan\n\nKeep this." };
    await mirrorWorkspaceToLocalFolder(root as unknown as FileSystemDirectoryHandle, [source], [parent]);
    const restored = await readLocalFolderPreview(root as unknown as FileSystemDirectoryHandle);
    expect(restored.folders).toEqual([parent]);
    expect(restored.notes).toHaveLength(1);
    expect(restored.notes[0]).toMatchObject({ id: source.id, title: "Plan", content: "# Plan\n\nKeep this.", parentId: parent.id });
  });
});
