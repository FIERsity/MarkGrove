import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type LiveInlineKind =
  | "hide"
  | "strong"
  | "emphasis"
  | "strike"
  | "inline-code"
  | "link"
  | "list-marker"
  | "task"
  | "image"
  | "math-inline"
  | "html"
  | "horizontal-rule";

export interface LiveInlineSpec {
  from: number;
  to: number;
  kind: LiveInlineKind;
  text?: string;
  checked?: boolean;
  active?: boolean;
}

export interface LiveLineSpec {
  from: number;
  classes: string;
}

export interface LiveMathSpec {
  from: number;
  to: number;
  source: string;
  active: boolean;
}

export interface VisibleRange { from: number; to: number }

export interface TextChange { from: number; to: number; insert: string }

function selectionTouches(state: EditorState, from: number, to: number, revealSelection: boolean): boolean {
  if (!revealSelection) return false;
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.head >= from && range.head <= to;
    return range.from <= to && range.to >= from;
  });
}

function selectionTouchesLine(state: EditorState, position: number, revealSelection: boolean): boolean {
  if (!revealSelection) return false;
  const line = state.doc.lineAt(position);
  return state.selection.ranges.some((range) => range.from <= line.to && range.to >= line.from);
}

function addUnique(specs: LiveInlineSpec[], seen: Set<string>, spec: LiveInlineSpec): void {
  const key = `${spec.kind}:${spec.from}:${spec.to}`;
  if (seen.has(key)) return;
  seen.add(key);
  specs.push(spec);
}

export function buildLiveInlinePlan(state: EditorState, visibleRanges: readonly VisibleRange[], revealSelection = true): LiveInlineSpec[] {
  const specs: LiveInlineSpec[] = [];
  const seen = new Set<string>();
  const source = state.doc;

  for (const visible of visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const parent = node.node.parent;
        const parentName = parent?.name;
        const parentActive = parent ? selectionTouches(state, parent.from, parent.to, revealSelection) : selectionTouchesLine(state, node.from, revealSelection);
        const text = source.sliceString(node.from, node.to);

        if (node.name === "InlineMath") {
          if (!selectionTouches(state, node.from, node.to, revealSelection)) {
            const mathText = node.node.getChild("MathText");
            addUnique(specs, seen, {
              from: node.from, to: node.to, kind: "math-inline",
              text: mathText ? source.sliceString(mathText.from, mathText.to) : text.slice(1, -1),
            });
            return false;
          }
          return;
        }
        if (node.name === "Image") {
          if (!selectionTouches(state, node.from, node.to, revealSelection)) {
            const altMatch = /^!\[([^\]]*)\]/.exec(text);
            addUnique(specs, seen, { from: node.from, to: node.to, kind: "image", text: altMatch?.[1] ?? "" });
            return false;
          }
          return;
        }
        if (node.name === "StrongEmphasis") addUnique(specs, seen, { from: node.from, to: node.to, kind: "strong" });
        else if (node.name === "Emphasis") addUnique(specs, seen, { from: node.from, to: node.to, kind: "emphasis" });
        else if (node.name === "Strikethrough") addUnique(specs, seen, { from: node.from, to: node.to, kind: "strike" });
        else if (node.name === "InlineCode") addUnique(specs, seen, { from: node.from, to: node.to, kind: "inline-code" });
        else if (node.name === "Link") addUnique(specs, seen, { from: node.from, to: node.to, kind: "link" });
        else if (node.name === "HTMLTag") addUnique(specs, seen, { from: node.from, to: node.to, kind: "html" });
        else if (node.name === "HorizontalRule") addUnique(specs, seen, {
          from: node.from,
          to: node.to,
          kind: "horizontal-rule",
          active: selectionTouchesLine(state, node.from, revealSelection),
        });
        else if (node.name === "TaskMarker") {
          addUnique(specs, seen, { from: node.from, to: node.to, kind: "task", checked: /^\[[xX]\]$/.test(text) });
          return false;
        } else if (node.name === "ListMark") {
          if (!parentActive && /^[+*-]$/.test(text)) addUnique(specs, seen, { from: node.from, to: node.to, kind: "list-marker", text: "•" });
          else addUnique(specs, seen, { from: node.from, to: node.to, kind: "list-marker", text });
        } else if (
          node.name === "EmphasisMark" || node.name === "StrikethroughMark" || node.name === "HeaderMark" ||
          node.name === "LinkMark" || node.name === "CodeMark" || node.name === "CodeInfo" || node.name === "QuoteMark"
        ) {
          const active = node.name === "QuoteMark" ? selectionTouchesLine(state, node.from, revealSelection) : parentActive;
          if (!active) addUnique(specs, seen, { from: node.from, to: node.to, kind: "hide" });
        } else if (node.name === "URL" && parentName === "Link" && !parentActive) {
          addUnique(specs, seen, { from: node.from, to: node.to, kind: "hide" });
        }
      },
    });
  }
  return specs.sort((left, right) => left.from - right.from || left.to - right.to || left.kind.localeCompare(right.kind));
}

export function buildLiveLinePlan(state: EditorState): LiveLineSpec[] {
  const classes = new Map<number, Set<string>>();
  function addLine(position: number, className: string) {
    const lineFrom = state.doc.lineAt(position).from;
    const current = classes.get(lineFrom) ?? new Set<string>();
    current.add(className); classes.set(lineFrom, current);
  }
  function addRange(from: number, to: number, className: string) {
    let line = state.doc.lineAt(from);
    while (line.from <= to) {
      addLine(line.from, className);
      if (line.to >= state.doc.length || line.to >= to) break;
      line = state.doc.lineAt(line.to + 1);
    }
  }

  syntaxTree(state).iterate({
    enter(node) {
      const heading = /^ATXHeading([1-6])$/.exec(node.name);
      if (heading) addLine(node.from, `cm-live-heading cm-live-heading-${heading[1]}`);
      else if (node.name === "Blockquote") addRange(node.from, node.to, "cm-live-blockquote");
      else if (node.name === "ListItem") addRange(node.from, node.to, "cm-live-list-line");
      else if (node.name === "FencedCode") addRange(node.from, node.to, "cm-live-code-block");
      else if (node.name === "Table") addRange(node.from, node.to, "cm-live-table-line");
      else if (node.name === "DisplayMath") addRange(node.from, node.to, "cm-live-math-source");
    },
  });
  return [...classes.entries()].sort(([left], [right]) => left - right)
    .map(([from, names]) => ({ from, classes: [...names].join(" ") }));
}

export function buildDisplayMathPlan(state: EditorState): LiveMathSpec[] {
  const specs: LiveMathSpec[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "DisplayMath") return;
      const mathText = node.node.getChild("MathText");
      if (!mathText) return false;
      specs.push({
        from: node.from,
        to: node.to,
        source: state.doc.sliceString(mathText.from, mathText.to).trim(),
        active: selectionTouches(state, node.from, node.to, true),
      });
      return false;
    },
  });
  return specs;
}

export function taskMarkerChange(state: EditorState, position: number): TextChange | null {
  const line = state.doc.lineAt(position);
  let change: TextChange | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (node.name !== "TaskMarker" || change) return;
      const current = state.doc.sliceString(node.from, node.to);
      change = { from: node.from, to: node.to, insert: /^\[[xX]\]$/.test(current) ? "[ ]" : "[x]" };
    },
  });
  return change;
}
