import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { buildLiveInlinePlan, buildLiveLinePlan, taskMarkerChange } from "./livePreview";

function state(doc: string, cursor = 0): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ extensions: [GFM] })] });
}

describe("live preview plan", () => {
  it("hides syntax away from the cursor and reveals the active formatted span", () => {
    const doc = "# Title\n\nRead **bold** and [link](https://example.test).";
    const inactive = state(doc, doc.indexOf("Read"));
    const plan = buildLiveInlinePlan(inactive, [{ from: 0, to: doc.length }]);
    const hidden = plan.filter((item) => item.kind === "hide").map((item) => doc.slice(item.from, item.to));
    expect(hidden).toEqual(expect.arrayContaining(["#", "**", "[", "]", "(", "https://example.test", ")"]));

    const active = state(doc, doc.indexOf("bold") + 1);
    const activePlan = buildLiveInlinePlan(active, [{ from: 0, to: doc.length }]);
    expect(activePlan.filter((item) => item.kind === "hide").map((item) => doc.slice(item.from, item.to))).not.toContain("**");
  });

  it("creates interactive task and private image placeholders", () => {
    const doc = "- [x] Done\n\n![private](https://example.test/image.png)";
    const plan = buildLiveInlinePlan(state(doc), [{ from: 0, to: doc.length }]);
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "task", checked: true }),
      expect.objectContaining({ kind: "image", text: "private" }),
    ]));
  });

  it("marks structural lines without changing the source", () => {
    const doc = "## Heading\n\n> Quote\n\n```js\nconst x = 1\n```";
    const current = state(doc);
    expect(buildLiveLinePlan(current).map((item) => item.classes).join(" ")).toContain("cm-live-heading-2");
    expect(buildLiveLinePlan(current).map((item) => item.classes).join(" ")).toContain("cm-live-code-block");
    expect(current.doc.toString()).toBe(doc);
  });

  it("toggles only the task marker on the active line", () => {
    const doc = "- [ ] First\n- [x] Second";
    const current = state(doc);
    expect(taskMarkerChange(current, doc.indexOf("First"))).toEqual({ from: 2, to: 5, insert: "[x]" });
    expect(taskMarkerChange(current, doc.indexOf("Second"))).toEqual({ from: 14, to: 17, insert: "[ ]" });
  });
});
