import { MAX_MARKDOWN_BYTES, parseMarkdown, safeFilename, serializeMarkdown } from "./markdown";
import type { FolderRecord, NoteRecord } from "../types";

export const LOCAL_FOLDER_FORMAT = "markgrove-local-folder";
export const LOCAL_FOLDER_VERSION = 1;
const MAX_LOCAL_FOLDER_NOTES = 5_000;
const MAX_LOCAL_FOLDER_FOLDERS = 2_000;

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};
type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  requestPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
};

export interface LocalFolderManifestNote {
  id: string;
  path: string;
  parentId: string;
  orderKey: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  snapshotAt: number;
  pinned: boolean;
  trashedAt: number | null;
  lastOpenedAt: number | null;
}

export interface LocalFolderManifest {
  format: typeof LOCAL_FOLDER_FORMAT;
  version: typeof LOCAL_FOLDER_VERSION;
  exportedAt: string;
  folders: FolderRecord[];
  notes: LocalFolderManifestNote[];
}

export interface LocalFolderPreview {
  notes: NoteRecord[];
  folders: FolderRecord[];
  exportedAt: string;
}

export function supportsLocalFolderBackup(): boolean {
  return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export async function pickLocalFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("LOCAL_FOLDER_UNSUPPORTED");
  return picker({ mode: "readwrite" });
}

export async function hasLocalFolderPermission(handle: FileSystemDirectoryHandle, request = false): Promise<boolean> {
  const options = { mode: "readwrite" as const };
  const permissioned = handle as PermissionedDirectoryHandle;
  if (!permissioned.queryPermission || !permissioned.requestPermission) return false;
  if (await permissioned.queryPermission(options) === "granted") return true;
  return request && await permissioned.requestPermission(options) === "granted";
}

function pathSegment(value: string, fallback: string): string {
  return safeFilename(value).replace(/\.md$/i, "").slice(0, 72).trim() || fallback;
}

function withId(value: string, id: string): string {
  const base = safeFilename(value).replace(/\.md$/i, "");
  return `${base}--${id.slice(0, 8)}.md`;
}

function folderPathMap(folders: FolderRecord[]): Map<string, string[]> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const cache = new Map<string, string[]>();
  const visit = (id: string, trail = new Set<string>()): string[] => {
    const cached = cache.get(id);
    if (cached) return cached;
    const folder = byId.get(id);
    if (!folder || trail.has(id)) return [];
    const nextTrail = new Set(trail).add(id);
    const parent = folder.parentId === "root" ? [] : visit(folder.parentId, nextTrail);
    const result = [...parent, `${pathSegment(folder.name, "folder")}--${folder.id.slice(0, 8)}`];
    cache.set(id, result);
    return result;
  };
  for (const folder of folders) cache.set(folder.id, visit(folder.id));
  return cache;
}

function notePath(note: NoteRecord, folderPaths: Map<string, string[]>): string {
  const parent = folderPaths.get(note.parentId) ?? [];
  return ["notes", ...parent, withId(note.title, note.id)].join("/");
}

export function buildLocalFolderManifest(notes: NoteRecord[], folders: FolderRecord[], exportedAt = new Date().toISOString()): LocalFolderManifest {
  const folderPaths = folderPathMap(folders);
  return {
    format: LOCAL_FOLDER_FORMAT,
    version: LOCAL_FOLDER_VERSION,
    exportedAt,
    folders,
    notes: notes.map((note) => ({
      id: note.id,
      path: notePath(note, folderPaths),
      parentId: note.parentId,
      orderKey: note.orderKey,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      revision: note.revision,
      snapshotAt: note.snapshotAt,
      pinned: note.pinned,
      trashedAt: note.trashedAt,
      lastOpenedAt: note.lastOpenedAt,
    })),
  };
}

async function writeTextFile(root: FileSystemDirectoryHandle, path: string, source: string): Promise<void> {
  const segments = path.split("/");
  const filename = segments.pop();
  if (!filename) throw new Error("INVALID_LOCAL_PATH");
  let directory = root;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  try { await writable.write(source); }
  finally { await writable.close(); }
}

async function readTextFile(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const segments = path.split("/");
  const filename = segments.pop();
  if (!filename) throw new Error("INVALID_LOCAL_PATH");
  let directory = root;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
  const file = await directory.getFileHandle(filename);
  return (await file.getFile()).text();
}

function validateManifest(value: unknown): LocalFolderManifest {
  if (!value || typeof value !== "object") throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
  const raw = value as Partial<LocalFolderManifest>;
  if (raw.format !== LOCAL_FOLDER_FORMAT || raw.version !== LOCAL_FOLDER_VERSION ||
    !Array.isArray(raw.notes) || !Array.isArray(raw.folders)) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
  if (raw.notes.length > MAX_LOCAL_FOLDER_NOTES || raw.folders.length > MAX_LOCAL_FOLDER_FOLDERS) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
  const folders = raw.folders.map((entry) => {
    if (!entry || typeof entry.id !== "string" || typeof entry.parentId !== "string" ||
      typeof entry.name !== "string" || typeof entry.orderKey !== "string") throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
    return {
      id: entry.id, parentId: entry.parentId, name: entry.name, orderKey: entry.orderKey,
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      trashedAt: typeof entry.trashedAt === "number" ? entry.trashedAt : null,
    };
  });
  const notes = raw.notes.map((entry) => {
    if (!entry || typeof entry.id !== "string" || typeof entry.path !== "string" ||
      typeof entry.parentId !== "string" || typeof entry.orderKey !== "string" || !isSafeNotePath(entry.path)) {
      throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
    }
    return {
      id: entry.id, path: entry.path, parentId: entry.parentId, orderKey: entry.orderKey,
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      revision: Number.isFinite(entry.revision) ? entry.revision : 0,
      snapshotAt: Number.isFinite(entry.snapshotAt) ? entry.snapshotAt : 0,
      pinned: Boolean(entry.pinned), trashedAt: typeof entry.trashedAt === "number" ? entry.trashedAt : null,
      lastOpenedAt: typeof entry.lastOpenedAt === "number" ? entry.lastOpenedAt : null,
    };
  });
  validateGraph(folders, notes);
  return { format: LOCAL_FOLDER_FORMAT, version: LOCAL_FOLDER_VERSION, exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "", folders, notes };
}

function isSafeNotePath(path: string): boolean {
  if (!path.startsWith("notes/") || !path.endsWith(".md") || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validateGraph(folders: FolderRecord[], notes: Array<Pick<LocalFolderManifestNote, "id" | "parentId">>): void {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const allIds = new Set<string>();
  for (const id of [...folderIds, ...notes.map((note) => note.id)]) {
    if (!id || allIds.has(id)) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
    allIds.add(id);
  }
  for (const folder of folders) {
    if (folder.parentId !== "root" && !folderIds.has(folder.parentId)) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
    const seen = new Set([folder.id]); let parentId = folder.parentId;
    while (parentId !== "root") {
      if (seen.has(parentId)) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
      seen.add(parentId); parentId = folders.find((candidate) => candidate.id === parentId)?.parentId ?? "";
      if (!parentId) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
    }
  }
  for (const note of notes) if (note.parentId !== "root" && !folderIds.has(note.parentId)) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST");
}

export async function mirrorWorkspaceToLocalFolder(handle: FileSystemDirectoryHandle, notes: NoteRecord[], folders: FolderRecord[]): Promise<LocalFolderManifest> {
  const manifest = buildLocalFolderManifest(notes, folders);
  for (const [index, note] of notes.entries()) {
    await writeTextFile(handle, manifest.notes[index]!.path, serializeMarkdown(note));
  }
  await writeTextFile(handle, ".markgrove/manifest.json", JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function readLocalFolderPreview(handle: FileSystemDirectoryHandle): Promise<LocalFolderPreview> {
  let manifest: LocalFolderManifest;
  try { manifest = validateManifest(JSON.parse(await readTextFile(handle, ".markgrove/manifest.json"))); }
  catch (error) { if (error instanceof SyntaxError) throw new Error("INVALID_LOCAL_FOLDER_MANIFEST"); throw error; }
  const notes: NoteRecord[] = [];
  for (const entry of manifest.notes) {
    const source = await readTextFile(handle, entry.path);
    if (new TextEncoder().encode(source).byteLength > MAX_MARKDOWN_BYTES) throw new Error("LOCAL_FOLDER_NOTE_TOO_LARGE");
    const parsed = parseMarkdown(entry.path, source);
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
      parentId: entry.parentId,
      orderKey: entry.orderKey,
      lastOpenedAt: typeof entry.lastOpenedAt === "number" ? entry.lastOpenedAt : null,
    });
  }
  return { notes, folders: manifest.folders, exportedAt: manifest.exportedAt };
}
