import { ROOT_FOLDER_ID, type BackupPreview, type FolderRecord, type NoteRecord } from "../types";
import { initialOrderKey } from "./order";
import { MAX_MARKDOWN_BYTES, parseMarkdown, safeFilename, serializeMarkdown } from "./markdown";

const BACKUP_FORMAT = "markgrove-backup";
const BACKUP_VERSION = 2;
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_MARKDOWN_BYTES = 100 * 1024 * 1024;
const MAX_BACKUP_NOTES = 5_000;
const MAX_BACKUP_FOLDERS = 2_000;

interface LegacyBackupEntry {
  id: string;
  file: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  snapshotAt: number;
  pinned: boolean;
  trashedAt: number | null;
}

interface BackupEntry extends LegacyBackupEntry {
  parentId: string;
  orderKey: string;
  lastOpenedAt: number | null;
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: 2;
  exportedAt: string;
  folders: FolderRecord[];
  notes: BackupEntry[];
}

function uniqueBackupPath(note: NoteRecord, index: number): string {
  const base = safeFilename(note.title).replace(/\.md$/i, "");
  const id = note.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `notes/${String(index + 1).padStart(5, "0")}-${base}-${id}.md`;
}

export async function createBackup(notes: NoteRecord[], folders: FolderRecord[] = []): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const entries: BackupEntry[] = [];
  for (const [index, note] of notes.entries()) {
    const file = uniqueBackupPath(note, index);
    zip.file(file, serializeMarkdown(note));
    entries.push({
      id: note.id, file, parentId: note.parentId, orderKey: note.orderKey,
      createdAt: note.createdAt, updatedAt: note.updatedAt, revision: note.revision,
      snapshotAt: note.snapshotAt, pinned: note.pinned, trashedAt: note.trashedAt,
      lastOpenedAt: note.lastOpenedAt,
    });
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    folders, notes: entries,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function isSafeNotePath(path: string): boolean {
  if (!path.startsWith("notes/") || !path.endsWith(".md") || path.includes("\\")) return false;
  const segments = path.split("/");
  return segments.length === 2 && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("INVALID_TIMESTAMP");
  return value;
}

function validateFolderGraph(folders: FolderRecord[], notes: Array<{ id: string; parentId: string }>): void {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const allIds = new Set<string>();
  for (const id of [...folderIds, ...notes.map((note) => note.id)]) {
    if (!id || allIds.has(id)) throw new Error("DUPLICATE_ID");
    allIds.add(id);
  }
  for (const folder of folders) {
    if (!folder.parentId || (folder.parentId !== ROOT_FOLDER_ID && !folderIds.has(folder.parentId))) throw new Error("MISSING_PARENT");
    const seen = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== ROOT_FOLDER_ID) {
      if (seen.has(parentId)) throw new Error("FOLDER_CYCLE");
      seen.add(parentId);
      const parent = folders.find((candidate) => candidate.id === parentId);
      if (!parent) throw new Error("MISSING_PARENT");
      parentId = parent.parentId;
    }
  }
  for (const note of notes) {
    if (!note.parentId || (note.parentId !== ROOT_FOLDER_ID && !folderIds.has(note.parentId))) throw new Error("MISSING_PARENT");
  }
}

function parseFolders(value: unknown): FolderRecord[] {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_FOLDERS) throw new Error("INVALID_FOLDERS");
  return value.map((raw) => {
    const folder = raw as Partial<FolderRecord>;
    if (!folder || typeof folder.id !== "string" || typeof folder.parentId !== "string" ||
      typeof folder.name !== "string" || typeof folder.orderKey !== "string") throw new Error("INVALID_FOLDER");
    return {
      id: folder.id, parentId: folder.parentId, name: folder.name, orderKey: folder.orderKey,
      createdAt: finiteNumber(folder.createdAt), updatedAt: finiteNumber(folder.updatedAt),
      trashedAt: nullableTimestamp(folder.trashedAt),
    };
  });
}

export async function inspectBackup(blob: Blob, existingIds: Set<string>): Promise<BackupPreview> {
  if (blob.size > MAX_BACKUP_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("MISSING_MANIFEST");
  let raw: { format?: unknown; version?: unknown; exportedAt?: unknown; notes?: unknown; folders?: unknown };
  try { raw = JSON.parse(await manifestFile.async("string")) as typeof raw; }
  catch { throw new Error("INVALID_MANIFEST"); }
  if (raw.format !== BACKUP_FORMAT || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.notes)) {
    throw new Error("INVALID_MANIFEST");
  }
  if (raw.notes.length > MAX_BACKUP_NOTES) throw new Error("TOO_MANY_NOTES");

  const version = raw.version;
  const folders = version === 2 ? parseFolders(raw.folders) : [];
  const paths = new Set<string>();
  const notes: NoteRecord[] = [];
  let extractedBytes = 0;
  for (const [index, rawEntry] of raw.notes.entries()) {
    const entry = rawEntry as Partial<BackupEntry>;
    if (!entry || typeof entry.id !== "string" || typeof entry.file !== "string" || !isSafeNotePath(entry.file) || paths.has(entry.file)) {
      throw new Error("INVALID_ENTRY");
    }
    paths.add(entry.file);
    const file = zip.file(entry.file);
    if (!file) throw new Error("MISSING_NOTE");
    const source = await file.async("string");
    const size = new TextEncoder().encode(source).byteLength;
    extractedBytes += size;
    if (size > MAX_MARKDOWN_BYTES) throw new Error("NOTE_TOO_LARGE");
    if (extractedBytes > MAX_UNCOMPRESSED_MARKDOWN_BYTES) throw new Error("BACKUP_EXPANDS_TOO_LARGE");
    const parsed = parseMarkdown(entry.file, source);
    const parentId = version === 2 && typeof entry.parentId === "string" ? entry.parentId : ROOT_FOLDER_ID;
    const orderKey = version === 2 && typeof entry.orderKey === "string" ? entry.orderKey : initialOrderKey(index);
    notes.push({
      id: entry.id, title: parsed.title, content: parsed.content, tags: parsed.tags,
      frontmatter: parsed.frontmatter, createdAt: finiteNumber(entry.createdAt, Date.now()),
      updatedAt: finiteNumber(entry.updatedAt, Date.now()), revision: finiteNumber(entry.revision),
      snapshotAt: finiteNumber(entry.snapshotAt), pinned: Boolean(entry.pinned),
      trashedAt: nullableTimestamp(entry.trashedAt), parentId, orderKey,
      lastOpenedAt: version === 2 ? nullableTimestamp(entry.lastOpenedAt) : null,
    });
  }
  validateFolderGraph(folders, notes);
  return {
    notes, folders,
    conflicts: [...folders, ...notes].filter((item) => existingIds.has(item.id)).length,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
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
