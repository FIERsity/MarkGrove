import { describe, expect, it } from "vitest";
import { ROOT_FOLDER_ID, type FolderRecord, type NoteRecord } from "../types";
import { flattenWorkspaceTree, folderBreadcrumbs, visibleNotesForNavigation } from "./workspace";

const folder = (id: string, parentId = ROOT_FOLDER_ID, orderKey = "1"): FolderRecord => ({ id, parentId, orderKey, name: id, createdAt: 1, updatedAt: 1, trashedAt: null });
const note = (id: string, parentId = ROOT_FOLDER_ID, orderKey = "1"): NoteRecord => ({ id, parentId, orderKey, title: id, content: "", tags: [], frontmatter: {}, createdAt: 1, updatedAt: 1, revision: 0, snapshotAt: 0, pinned: false, trashedAt: null, lastOpenedAt: null });

describe("workspace hierarchy", () => {
  it("flattens only expanded branches and exposes stable breadcrumbs", () => {
    const folders = [folder("work"), folder("project", "work")];
    const notes = [note("root-note", ROOT_FOLDER_ID, "2"), note("nested", "project")];
    expect(flattenWorkspaceTree(folders, notes, new Set()).map((item) => item.id)).toEqual(["work", "root-note"]);
    expect(flattenWorkspaceTree(folders, notes, new Set(["work", "project"])).map((item) => item.id)).toEqual(["work", "project", "nested", "root-note"]);
    expect(folderBreadcrumbs("project", folders).map((item) => item.id)).toEqual(["work", "project"]);
  });

  it("treats Inbox and folders as real location views", () => {
    const folders = [folder("work")]; const notes = [note("inbox"), note("inside", "work")];
    expect(visibleNotesForNavigation(notes, folders, { kind: "inbox" }).map((item) => item.id)).toEqual(["inbox"]);
    expect(visibleNotesForNavigation(notes, folders, { kind: "folder", folderId: "work" }).map((item) => item.id)).toEqual(["inside"]);
  });
});
