import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { MathMarkdown } from "./mathMarkdown";
import { blockAtPosition, buildBlockGraph, buildOutline, convertBlock, deleteBlock, documentBlocks, dropBlock, duplicateBlock, moveBlock, moveSingleBlock, pickDropDestination, type BlockBox, type BlockRef } from "./documentStructure";

function state(doc: string, anchor = 0, head = anchor) {
  return EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ extensions: [GFM, MathMarkdown] })] });
}

function apply(doc: string, edit: ReturnType<typeof moveBlock>): string {
  if (!edit) return doc;
  const changes = Array.isArray(edit.change) ? [...edit.change] : [edit.change];
  return changes.sort((left, right) => right.from - left.from || right.to - left.to).reduce((text, change) => `${text.slice(0, change.from)}${change.insert}${text.slice(change.to)}`, doc);
}


function layout(entries: Array<[BlockRef, BlockBox]>) {
  const map = new Map(entries.map(([block, box]) => [block.key, box]));
  return (block: BlockRef) => map.get(block.key) ?? null;
}

describe("Markdown-derived document blocks", () => {
  it("distinguishes headings, rules and atomic structures", () => {
    const current = state("Next\n---\n\n---\n\n```js\nx\n```\n\n$$\nx+y\n$$");
    expect(buildBlockGraph(current).map((block) => block.kind)).toEqual(["heading", "horizontal-rule", "code", "math"]);
  });

  it("moves a paragraph with one change while preserving separator slots and selection", () => {
    const doc = "Alpha\n\n\nBeta\n\nGamma";
    const edit = moveBlock(state(doc, doc.indexOf("Beta") + 2), doc.indexOf("Beta") + 2, -1);
    expect(apply(doc, edit)).toBe("Beta\n\n\nAlpha\n\nGamma");
    expect(edit?.anchor).toBe(2);
  });

  it("moves a list item with its nested children", () => {
    const doc = "- one\n  - child\n- two";
    const edit = moveBlock(state(doc, 2), 2, 1);
    expect(apply(doc, edit)).toBe("- two\n- one\n  - child");
  });

  it("selects a list item rather than its synthetic list container", () => {
    const current = state("- only item");
    expect(blockAtPosition(buildBlockGraph(current), 3)?.kind).toBe("list-item");
  });

  it("keeps ordered-list markers in their destination slots", () => {
    const doc = "1. one\n2. two";
    const edit = moveBlock(state(doc, doc.indexOf("two")), doc.indexOf("two"), -1);
    expect(apply(doc, edit)).toBe("1. two\n2. one");
  });

  it("reindents ordered-list continuations across marker-width boundaries", () => {
    const doc = "9. nine\n   continuation\n10. ten\n    - child";
    const edit = moveBlock(state(doc, doc.indexOf("ten")), doc.indexOf("ten"), -1);
    expect(apply(doc, edit)).toBe("9. ten\n   - child\n10. nine\n    continuation");
  });

  it("moves a contiguous multi-block selection as one unit", () => {
    const doc = "A\n\nB\n\nC\n\nD";
    const edit = moveBlock(state(doc, doc.indexOf("B"), doc.indexOf("C") + 1), doc.indexOf("C"), 1);
    expect(apply(doc, edit)).toBe("A\n\nD\n\nB\n\nC");
    expect(edit?.anchor).toBe(6);
    expect(edit?.head).toBe(10);
  });

  it("rejects cross-parent selections and lets explicit handles move one block", () => {
    const doc = "Intro\n\n- parent\n  - child\n\nOutro";
    const current = state(doc, doc.indexOf("Intro"), doc.indexOf("child") + 5);
    expect(moveBlock(current, doc.indexOf("child"), 1)).toBeNull();
    expect(apply(doc, moveSingleBlock(current, doc.indexOf("Outro"), -1))).toBe("Intro\n\nOutro\n\n- parent\n  - child");
  });

  it("duplicates, deletes and converts simple blocks", () => {
    const doc = "First\n\nSecond";
    expect(apply(doc, duplicateBlock(state(doc, 1), 1))).toBe("First\n\nFirst\n\nSecond");
    expect(apply(doc, deleteBlock(state(doc, 1), 1))).toBe("Second");
    expect(apply("Plain", convertBlock(state("Plain", 1), 1, "heading-2"))).toBe("## Plain");
  });

  it("derives a nested outline without persistent ids", () => {
    const outline = buildOutline(state("# A\n\n## B\n\n### C\n\n## D"));
    expect(outline.map(({ level, text, parentFrom }) => ({ level, text, parentFrom }))).toEqual([
      { level: 1, text: "A", parentFrom: null },
      { level: 2, text: "B", parentFrom: 0 },
      { level: 3, text: "C", parentFrom: 5 },
      { level: 2, text: "D", parentFrom: 0 },
    ]);
  });
});

describe("pointer drop slots", () => {
  it("picks inter-block gaps instead of blank-line positions", () => {
    const doc = "Alpha\n\n\nBeta\n\nGamma";
    const current = state(doc, 1);
    const blocks = buildBlockGraph(current);
    const [alpha, beta, gamma] = documentBlocks(blocks);
    const boxOf = layout([
      [alpha!, { top: 0, bottom: 30 }],
      [beta!, { top: 60, bottom: 90 }],
      [gamma!, { top: 120, bottom: 150 }],
    ]);
    const afterSelf = pickDropDestination(alpha!, blocks, 40, boxOf);
    expect(afterSelf).toMatchObject({ status: "noop", dest: { action: "reorder", index: 1 } });
    const afterBeta = pickDropDestination(alpha!, blocks, 90, boxOf);
    expect(afterBeta).toMatchObject({ status: "legal", dest: { action: "reorder", parentKey: "document", index: 2 } });
    expect(apply(doc, dropBlock(current, alpha!.from, afterBeta!.dest))).toBe("Beta\n\n\nAlpha\n\nGamma");
  });

  it("converts a heading into a list item at the hovered slot", () => {
    const doc = "## Title\n\n- one\n- two\n\nOutro";
    const current = state(doc, 3);
    const blocks = buildBlockGraph(current);
    const heading = blocks.find((block) => block.kind === "heading")!;
    const list = blocks.find((block) => block.kind === "list")!;
    const items = blocks.filter((block) => block.parentKey === list.key);
    const outro = blocks.find((block) => block.kind === "paragraph")!;
    const boxOf = layout([
      [heading, { top: 0, bottom: 30 }],
      [list, { top: 40, bottom: 100 }],
      [items[0]!, { top: 45, bottom: 65 }],
      [items[1]!, { top: 75, bottom: 95 }],
      [outro, { top: 120, bottom: 150 }],
    ]);
    const pick = pickDropDestination(heading, blocks, 70, boxOf);
    expect(pick).toMatchObject({ status: "legal", hint: "become-list-item", dest: { action: "convert-to-list-item", parentKey: list.key, index: 1 } });
    expect(apply(doc, dropBlock(current, heading.from, pick!.dest))).toBe("- one\n- Title\n- two\n\nOutro");
  });

  it("unwraps the last list item and removes the emptied list", () => {
    const doc = "Intro\n\n- only\n  - child\n\nOutro";
    const current = state(doc, doc.indexOf("only"));
    const blocks = buildBlockGraph(current);
    const intro = blocks.find((block) => block.kind === "paragraph" && block.from === 0)!;
    const list = blocks.find((block) => block.kind === "list")!;
    const item = blocks.find((block) => block.kind === "list-item" && block.parentKey === list.key)!;
    const outro = blocks.find((block) => block.kind === "paragraph" && block !== intro)!;
    const boxOf = layout([
      [intro, { top: 0, bottom: 30 }],
      [list, { top: 40, bottom: 90 }],
      [item, { top: 45, bottom: 85 }],
      [outro, { top: 110, bottom: 140 }],
    ]);
    const pick = pickDropDestination(item, blocks, 160, boxOf);
    expect(pick).toMatchObject({ status: "legal", hint: "leave-list", dest: { action: "unwrap-to-document", parentKey: "document", index: 3 } });
    expect(apply(doc, dropBlock(current, item.from, pick!.dest))).toBe("Intro\n\nOutro\n\nonly\n- child");
  });

  it("joins another list and refuses to convert a code block", () => {
    const doc = "- keep\n- move\n\n1. one\n2. two\n\n```js\nx\n```";
    const current = state(doc, doc.indexOf("move"));
    const blocks = buildBlockGraph(current);
    const lists = blocks.filter((block) => block.kind === "list");
    const source = blocks.find((block) => block.kind === "list-item" && current.doc.sliceString(block.from, block.to).includes("move"))!;
    const ordered = lists[1]!;
    const orderedItems = blocks.filter((block) => block.parentKey === ordered.key);
    const code = blocks.find((block) => block.kind === "code")!;
    const sourceList = lists[0]!;
    const sourceItems = blocks.filter((block) => block.parentKey === sourceList.key);
    const boxOf = layout([
      [sourceList, { top: 0, bottom: 50 }],
      [sourceItems[0]!, { top: 0, bottom: 22 }],
      [sourceItems[1]!, { top: 24, bottom: 50 }],
      [ordered, { top: 70, bottom: 120 }],
      [orderedItems[0]!, { top: 72, bottom: 92 }],
      [orderedItems[1]!, { top: 98, bottom: 118 }],
      [code, { top: 140, bottom: 190 }],
    ]);
    const join = pickDropDestination(source, blocks, 96, boxOf);
    expect(join).toMatchObject({ status: "legal", hint: "join-list", dest: { action: "join-list", parentKey: ordered.key, index: 1 } });
    expect(apply(doc, dropBlock(current, source.from, join!.dest))).toBe("- keep\n\n1. one\n2. move\n2. two\n\n```js\nx\n```");
    expect(dropBlock(current, code.from, { action: "convert-to-list-item", parentKey: ordered.key, index: 1 })).toBeNull();
    expect(pickDropDestination(code, blocks, 80, boxOf)).toMatchObject({ status: "forbidden", hint: "forbidden" });
  });

  it("still picks a slot when a middle sibling has no box", () => {
    const doc = "Alpha\n\nBeta\n\nGamma";
    const current = state(doc, 1);
    const blocks = buildBlockGraph(current);
    const [alpha, beta, gamma] = documentBlocks(blocks);
    const boxOf = (block: BlockRef): BlockBox | null => {
      if (block.key === beta!.key) return null;
      if (block.key === alpha!.key) return { top: 0, bottom: 30 };
      if (block.key === gamma!.key) return { top: 120, bottom: 150 };
      return null;
    };
    expect(pickDropDestination(alpha!, blocks, 80, boxOf)).toMatchObject({
      status: "legal",
      dest: { action: "reorder", parentKey: "document", index: 2 },
    });
    expect(pickDropDestination(gamma!, blocks, 10, boxOf)).toMatchObject({
      status: "legal",
      dest: { action: "reorder", parentKey: "document", index: 0 },
    });
  });
});
