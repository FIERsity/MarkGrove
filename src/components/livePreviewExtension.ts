import { syntaxTree } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { Range, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import type { Language } from "../types";
import { buildLiveInlinePlan, buildLiveLinePlan, taskMarkerChange, type LiveInlineSpec } from "../lib/livePreview";
import { safeExternalLink } from "../lib/renderPolicy";

class TextWidget extends WidgetType {
  readonly text: string;
  readonly className: string;
  readonly label?: string;
  constructor(text: string, className: string, label?: string) { super(); this.text = text; this.className = className; this.label = label; }
  eq(other: TextWidget) { return other.text === this.text && other.className === this.className && other.label === this.label; }
  toDOM() {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.text;
    if (this.label) element.setAttribute("aria-label", this.label);
    return element;
  }
}

class TaskWidget extends WidgetType {
  readonly checked: boolean;
  readonly from: number;
  readonly language: Language;
  constructor(checked: boolean, from: number, language: Language) { super(); this.checked = checked; this.from = from; this.language = language; }
  eq(other: TaskWidget) { return other.checked === this.checked && other.from === this.from && other.language === this.language; }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.className = `cm-live-task${this.checked ? " checked" : ""}`;
    button.dataset.taskFrom = String(this.from);
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-checked", String(this.checked));
    button.setAttribute("aria-label", this.language === "zh" ? (this.checked ? "标记为未完成" : "标记为完成") : (this.checked ? "Mark incomplete" : "Mark complete"));
    button.textContent = this.checked ? "✓" : "";
    return button;
  }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  readonly alt: string;
  readonly language: Language;
  constructor(alt: string, language: Language) { super(); this.alt = alt; this.language = language; }
  eq(other: ImageWidget) { return other.alt === this.alt && other.language === this.language; }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-live-image";
    element.setAttribute("role", "note");
    element.setAttribute("aria-label", this.language === "zh" ? `远程图片已阻止：${this.alt || "无替代文字"}` : `Remote image blocked: ${this.alt || "no alt text"}`);
    const icon = document.createElement("span"); icon.textContent = "▧"; icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span"); text.textContent = this.alt || (this.language === "zh" ? "远程图片已阻止" : "Remote image blocked");
    element.append(icon, text);
    return element;
  }
  ignoreEvent() { return false; }
}

function decorationFor(spec: LiveInlineSpec, language: Language): Range<Decoration> {
  if (spec.kind === "hide") return Decoration.replace({}).range(spec.from, spec.to);
  if (spec.kind === "task") return Decoration.replace({ widget: new TaskWidget(Boolean(spec.checked), spec.from, language) }).range(spec.from, spec.to);
  if (spec.kind === "image") return Decoration.replace({ widget: new ImageWidget(spec.text ?? "", language) }).range(spec.from, spec.to);
  if (spec.kind === "list-marker" && spec.text === "•") {
    return Decoration.replace({ widget: new TextWidget("•", "cm-live-bullet", language === "zh" ? "项目符号" : "Bullet") }).range(spec.from, spec.to);
  }
  const className = {
    strong: "cm-live-strong",
    emphasis: "cm-live-emphasis",
    strike: "cm-live-strike",
    "inline-code": "cm-live-inline-code",
    link: "cm-live-link",
    "list-marker": "cm-live-list-marker",
    html: "cm-live-html",
    "horizontal-rule": "cm-live-horizontal-rule",
  }[spec.kind];
  const editable = spec.kind === "strong" || spec.kind === "emphasis" || spec.kind === "strike" || spec.kind === "inline-code" || spec.kind === "link";
  return Decoration.mark({
    class: className,
    attributes: editable ? { "data-live-edit-from": String(spec.from), "data-live-edit-to": String(spec.to) } : undefined,
  }).range(spec.from, spec.to);
}

function inlineDecorations(view: EditorView, language: Language): { decorations: DecorationSet; atomic: DecorationSet } {
  const plan = buildLiveInlinePlan(view.state, view.visibleRanges, view.hasFocus);
  return {
    decorations: Decoration.set(plan.map((spec) => decorationFor(spec, language)), true),
    atomic: Decoration.set(plan.filter((spec) => spec.kind === "hide" || spec.kind === "task" || spec.kind === "image" || (spec.kind === "list-marker" && spec.text === "•"))
      .map((spec) => decorationFor(spec, language)), true),
  };
}

function lineDecorations(state: EditorState): DecorationSet {
  return Decoration.set(buildLiveLinePlan(state).map((spec) => Decoration.line({ class: spec.classes }).range(spec.from)), true);
}

function linkAt(state: EditorState, position: number): string | undefined {
  let node = syntaxTree(state).resolve(position, 1);
  while (node && node.name !== "Link") node = node.parent!;
  const url = node?.getChild("URL");
  return url ? state.doc.sliceString(url.from, url.to) : undefined;
}

export function livePreviewExtension(language: Language): Extension {
  const lines = StateField.define<DecorationSet>({
    create: lineDecorations,
    update(value, transaction) { return transaction.docChanged ? lineDecorations(transaction.state) : value; },
    provide: (field) => EditorView.decorations.from(field),
  });
  const inline = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      const sets = inlineDecorations(view, language); this.decorations = sets.decorations; this.atomic = sets.atomic;
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        const sets = inlineDecorations(update.view, language); this.decorations = sets.decorations; this.atomic = sets.atomic;
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const task = target?.closest<HTMLElement>("[data-task-from]");
        if (task) {
          event.preventDefault();
          const from = Number(task.dataset.taskFrom);
          const change = Number.isFinite(from) ? taskMarkerChange(view.state, from) : null;
          if (change) view.dispatch({ changes: change, selection: { anchor: change.from + change.insert.length } });
          view.focus();
          return true;
        }
        const rendered = target?.closest<HTMLElement>("[data-live-edit-from]");
        if ((event.metaKey || event.ctrlKey) && rendered?.classList.contains("cm-live-link")) {
          const href = safeExternalLink(linkAt(view.state, Number(rendered.dataset.liveEditFrom)));
          if (href) {
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
        }
        if (rendered) {
          event.preventDefault();
          const owner = view.dom.ownerDocument;
          const caret = owner.caretPositionFromPoint?.(event.clientX, event.clientY);
          const from = Number(rendered.dataset.liveEditFrom);
          const to = Number(rendered.dataset.liveEditTo);
          let position = from;
          if (caret) {
            try { position = view.posAtDOM(caret.offsetNode, caret.offset); }
            catch { position = from; }
          }
          view.dispatch({ selection: { anchor: Math.max(from, Math.min(to, position)) }, scrollIntoView: true });
          view.focus();
          return true;
        }
        return false;
      },
    },
  });
  return [
    lines,
    inline,
    EditorView.atomicRanges.of((view) => view.plugin(inline)?.atomic ?? Decoration.none),
    keymap.of([{
      key: "Mod-Enter",
      run(view) {
        const change = taskMarkerChange(view.state, view.state.selection.main.head);
        if (!change) return false;
        view.dispatch({ changes: change });
        return true;
      },
    }]),
  ];
}
