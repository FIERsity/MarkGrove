import type { BackupPreview, NoteRecord } from "../types";
import { MAX_MARKDOWN_BYTES, parseMarkdown, safeFilename, serializeMarkdown } from "./markdown";

const BACKUP_FORMAT = "markgrove-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_BACKUP_NOTES = 5_000;

interface BackupEntry {
  id: string;
  file: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  snapshotAt: number;
  pinned: boolean;
  trashedAt: number | null;
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  notes: BackupEntry[];
}

function uniqueBackupPath(note: NoteRecord): string {
  const base = safeFilename(note.title).replace(/\.md$/i, "");
  return `notes/${base}-${note.id.slice(0, 8)}.md`;
}

export async function createBackup(notes: NoteRecord[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const entries: BackupEntry[] = [];
  for (const note of notes) {
    const file = uniqueBackupPath(note);
    zip.file(file, serializeMarkdown(note));
    entries.push({
      id: note.id,
      file,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      revision: note.revision,
      snapshotAt: note.snapshotAt,
      pinned: note.pinned,
      trashedAt: note.trashedAt,
    });
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    notes: entries,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function isSafeNotePath(path: string): boolean {
  return path.startsWith("notes/") && !path.includes("..") && !path.includes("\\") && path.endsWith(".md");
}

export async function inspectBackup(blob: Blob, existingIds: Set<string>): Promise<BackupPreview> {
  if (blob.size > MAX_BACKUP_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("MISSING_MANIFEST");
  const manifest = JSON.parse(await manifestFile.async("string")) as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION || !Array.isArray(manifest.notes)) {
    throw new Error("INVALID_MANIFEST");
  }
  if (manifest.notes.length > MAX_BACKUP_NOTES) throw new Error("TOO_MANY_NOTES");

  const notes: NoteRecord[] = [];
  for (const entry of manifest.notes) {
    if (!entry || typeof entry.id !== "string" || typeof entry.file !== "string" || !isSafeNotePath(entry.file)) {
      throw new Error("INVALID_ENTRY");
    }
    const file = zip.file(entry.file);
    if (!file) throw new Error("MISSING_NOTE");
    const source = await file.async("string");
    if (new TextEncoder().encode(source).byteLength > MAX_MARKDOWN_BYTES) throw new Error("NOTE_TOO_LARGE");
    const parsed = parseMarkdown(entry.file, source);
    notes.push({
      id: entry.id,
      title: parsed.title,
      content: parsed.content,
      tags: parsed.tags,
      frontmatter: parsed.frontmatter,
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
      revision: Number.isFinite(entry.revision) ? entry.revision : 0,
      snapshotAt: Number.isFinite(entry.snapshotAt) ? entry.snapshotAt : 0,
      pinned: Boolean(entry.pinned),
      trashedAt: typeof entry.trashedAt === "number" ? entry.trashedAt : null,
    });
  }
  return {
    notes,
    conflicts: notes.filter((note) => existingIds.has(note.id)).length,
    exportedAt: typeof manifest.exportedAt === "string" ? manifest.exportedAt : "",
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
