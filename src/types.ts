export type Language = "zh" | "en";
export type Theme = "light" | "dark";
export type ViewMode = "edit" | "split" | "preview";

export const ROOT_FOLDER_ID = "root";

export interface FolderRecord {
  id: string;
  parentId: string;
  name: string;
  orderKey: string;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
}

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  revision: number;
  snapshotAt: number;
  pinned: boolean;
  trashedAt: number | null;
  parentId: string;
  orderKey: string;
  lastOpenedAt: number | null;
}

export interface RevisionRecord {
  id: string;
  noteId: string;
  revision: number;
  title: string;
  content: string;
  tags: string[];
  savedAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface NoteDraft {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

export interface BackupPreview {
  notes: NoteRecord[];
  folders: FolderRecord[];
  conflicts: number;
  exportedAt: string;
}

export type WorkspaceItemKind = "folder" | "note";

export interface ItemLocation {
  kind: WorkspaceItemKind;
  id: string;
  parentId: string;
  orderKey: string;
}
