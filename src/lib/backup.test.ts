import { describe, expect, it } from "vitest";
import type { NoteRecord } from "../types";
import { createBackup, inspectBackup } from "./backup";

function note(id: string, title: string): NoteRecord {
  return {
    id, title, content: `# ${title}\n\nPrivate body`, tags: ["portable"], frontmatter: { author: "Me" },
    createdAt: 10, updatedAt: 20, revision: 2, snapshotAt: 15, pinned: true, trashedAt: null,
  };
}

describe("versioned backup", () => {
  it("round-trips standard Markdown notes and reports ID conflicts", async () => {
    const source = note("12345678-abcd-4abc-8abc-123456789abc", "Field / notes");
    const blob = await createBackup([source]);
    const preview = await inspectBackup(blob, new Set([source.id]));
    expect(preview.conflicts).toBe(1);
    expect(preview.notes).toHaveLength(1);
    expect(preview.notes[0]).toMatchObject({
      id: source.id,
      title: source.title,
      content: source.content,
      tags: source.tags,
      pinned: true,
    });
  });

  it("rejects a ZIP without a MarkGrove manifest", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("notes/random.md", "# No manifest");
    const blob = await zip.generateAsync({ type: "blob" });
    await expect(inspectBackup(blob, new Set())).rejects.toThrow("MISSING_MANIFEST");
  });
});
