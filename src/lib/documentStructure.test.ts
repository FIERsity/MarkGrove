import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { MathMarkdown } from "./mathMarkdown";
import { blockAtPosition, buildBlockGraph, buildOutline, convertBlock, deleteBlock, duplicateBlock, moveBlock, moveSingleBlock } from "./documentStructure";

function state(doc: string, anchor = 0, head = anchor) {
  return EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ extensions: [GFM, MathMarkdown] })] });
}

function apply(doc: string, edit: ReturnType<typeof moveBlock>): string {
  if (!edit) return doc;
  return `${doc.slice(0, edit.change.from)}${edit.change.insert}${doc.slice(edit.change.to)}`;
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
