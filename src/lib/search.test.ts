import { describe, expect, it } from "vitest";
import type { NoteRecord } from "../types";
import { collectTags, filterAndSortNotes } from "./search";

function note(overrides: Partial<NoteRecord>): NoteRecord {
  return {
    id: "a", title: "Alpha", content: "first idea", tags: [], frontmatter: {},
    createdAt: 1, updatedAt: 1, revision: 0, snapshotAt: 0, pinned: false, trashedAt: null,
    ...overrides,
  };
}

describe("note discovery", () => {
  const notes = [
    note({ id: "old", title: "Old", content: "archive", tags: ["work"], updatedAt: 3, trashedAt: 4 }),
    note({ id: "new", title: "Meeting", content: "roadmap", tags: ["work"], updatedAt: 10 }),
    note({ id: "pin", title: "Pinned", content: "reference", tags: ["home"], updatedAt: 2, pinned: true }),
  ];

  it("searches text and tags while keeping pinned notes first", () => {
    expect(filterAndSortNotes(notes, "", false, null).map((item) => item.id)).toEqual(["pin", "new"]);
    expect(filterAndSortNotes(notes, "roadmap", false, null).map((item) => item.id)).toEqual(["new"]);
    expect(filterAndSortNotes(notes, "", false, "work").map((item) => item.id)).toEqual(["new"]);
  });

  it("separates trash and counts active tags", () => {
    expect(filterAndSortNotes(notes, "", true, null).map((item) => item.id)).toEqual(["old"]);
    expect(collectTags(notes)).toEqual([{ tag: "home", count: 1 }, { tag: "work", count: 1 }]);
  });
});
