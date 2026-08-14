import type { NoteRecord } from "../types";

export function filterAndSortNotes(
  notes: NoteRecord[],
  query: string,
  trashed: boolean,
  activeTag: string | null,
): NoteRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return notes
    .filter((note) => trashed ? note.trashedAt !== null : note.trashedAt === null)
    .filter((note) => !activeTag || note.tags.includes(activeTag))
    .filter((note) => !needle || `${note.title}\n${note.content}\n${note.tags.join(" ")}`.toLocaleLowerCase().includes(needle))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt);
}

export function collectTags(notes: NoteRecord[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.trashedAt !== null) continue;
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}
