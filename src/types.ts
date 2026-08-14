export type Language = "zh" | "en";
export type Theme = "light" | "dark";
export type ViewMode = "edit" | "split" | "preview";

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
  conflicts: number;
  exportedAt: string;
}
