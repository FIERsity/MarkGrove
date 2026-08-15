import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Language } from "../types";
import {
  blockAtPosition, buildBlockGraph, convertBlock, deleteBlock, duplicateBlock, moveBlock, moveBlockToIndex, moveSingleBlock, siblingsFor,
  type BlockKind, type ConvertibleBlockKind, type StructureEdit,
} from "../lib/documentStructure";

const BLOCK_MIME = "application/x-markgrove-block";
const dropTargetEffect = StateEffect.define<{ position: number; side: "before" | "after" } | null>();

const dropTargetField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(dropTargetEffect)) continue;
      if (!effect.value) return Decoration.none;
      const line = transaction.state.doc.lineAt(effect.value.position);
      return Decoration.set([Decoration.line({ class: `cm-block-drop-${effect.value.side}` }).range(line.from)]);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const kindLabels: Record<BlockKind, { zh: string; en: string }> = {
  paragraph: { zh: "段落", en: "Paragraph" },
  heading: { zh: "标题", en: "Heading" },
  list: { zh: "列表", en: "List" },
  "list-item": { zh: "列表项", en: "List item" },
  blockquote: { zh: "引用", en: "Quote" },
  code: { zh: "代码块", en: "Code block" },
  math: { zh: "公式", en: "Math" },
  table: { zh: "表格", en: "Table" },
  "horizontal-rule": { zh: "分隔线", en: "Divider" },
  html: { zh: "HTML 源码", en: "HTML source" },
};

const conversionTargets: Array<{ target: ConvertibleBlockKind; zh: string; en: string }> = [
  { target: "paragraph", zh: "正文", en: "Text" },
  { target: "heading-1", zh: "一级标题", en: "Heading 1" },
  { target: "heading-2", zh: "二级标题", en: "Heading 2" },
  { target: "heading-3", zh: "三级标题", en: "Heading 3" },
  { target: "bullet", zh: "项目列表", en: "Bullet list" },
  { target: "ordered", zh: "编号列表", en: "Numbered list" },
  { target: "task", zh: "任务", en: "To-do" },
  { target: "blockquote", zh: "引用", en: "Quote" },
  { target: "code", zh: "代码", en: "Code" },
  { target: "math", zh: "公式", en: "Math" },
];

class BlockControlsWidget extends WidgetType {
  readonly from: number;
  readonly kind: BlockKind;
  readonly active: boolean;
  readonly language: Language;
  constructor(from: number, kind: BlockKind, active: boolean, language: Language) {
    super(); this.from = from; this.kind = kind; this.active = active; this.language = language;
  }
  eq(other: BlockControlsWidget) { return other.from === this.from && other.kind === this.kind && other.active === this.active && other.language === this.language; }
  toDOM() {
    const controls = document.createElement("span");
    controls.className = `cm-block-controls${this.active ? " active" : ""}`;
    controls.contentEditable = "false";
    controls.dataset.blockFrom = String(this.from);

    const add = document.createElement("button");
    add.type = "button"; add.className = "cm-block-add"; add.dataset.blockAction = "insert"; add.textContent = "+";
    add.setAttribute("aria-label", this.language === "zh" ? "在下方插入段落" : "Insert paragraph below");

    const handle = document.createElement("button");
    handle.type = "button"; handle.className = "cm-block-handle"; handle.draggable = true; handle.textContent = "⠿";
    const kind = kindLabels[this.kind][this.language];
    handle.setAttribute("aria-label", this.language === "zh" ? `${kind}操作与拖动` : `${kind} actions and drag handle`);

    const menu = document.createElement("span");
    menu.className = "cm-block-menu";
    menu.setAttribute("role", "menu");
    const actions = [
      ["up", this.language === "zh" ? "上移" : "Move up"],
      ["down", this.language === "zh" ? "下移" : "Move down"],
      ["duplicate", this.language === "zh" ? "复制" : "Duplicate"],
      ["delete", this.language === "zh" ? "删除" : "Delete"],
    ];
    for (const [action, label] of actions) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.blockAction = action; button.textContent = label; button.setAttribute("role", "menuitem"); menu.append(button);
    }
    const separator = document.createElement("span"); separator.className = "cm-block-menu-label"; separator.textContent = this.language === "zh" ? "转换为" : "Turn into"; menu.append(separator);
    for (const conversion of conversionTargets) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.blockAction = `convert:${conversion.target}`; button.textContent = this.language === "zh" ? conversion.zh : conversion.en; button.setAttribute("role", "menuitem"); menu.append(button);
    }
    controls.append(add, handle, menu);
    return controls;
  }
  ignoreEvent() { return false; }
}

function applyEdit(view: EditorView, edit: StructureEdit | null, userEvent: string): boolean {
  if (!edit || view.composing) return false;
  view.dispatch({
    changes: edit.change,
    selection: EditorSelection.range(edit.anchor, edit.head),
    scrollIntoView: true,
    annotations: [Transaction.userEvent.of(userEvent), isolateHistory.of("full")],
  });
  view.focus();
  return true;
}

function runAction(view: EditorView, from: number, action: string): boolean {
  if (action === "up") return applyEdit(view, moveSingleBlock(view.state, from, -1), "move.block");
  if (action === "down") return applyEdit(view, moveSingleBlock(view.state, from, 1), "move.block");
  if (action === "duplicate") return applyEdit(view, duplicateBlock(view.state, from), "input.block.duplicate");
  if (action === "delete") return applyEdit(view, deleteBlock(view.state, from), "delete.block");
  if (action.startsWith("convert:")) return applyEdit(view, convertBlock(view.state, from, action.slice(8) as ConvertibleBlockKind), "input.block.convert");
  if (action === "insert") {
    const block = blockAtPosition(buildBlockGraph(view.state), from);
    if (!block) return false;
    const insert = block.parentKey === "document" ? "\n\n" : "\n";
    view.dispatch({ changes: { from: block.to, insert }, selection: { anchor: block.to + insert.length }, scrollIntoView: true, userEvent: "input.block.insert" });
    view.focus();
    return true;
  }
  return false;
}

function blockControlDecorations(view: EditorView, language: Language): DecorationSet {
  const active = blockAtPosition(buildBlockGraph(view.state), view.state.selection.main.head);
  const decorations = buildBlockGraph(view.state)
    .filter((block) => block.kind !== "list" && view.visibleRanges.some((range) => block.from <= range.to && block.to >= range.from))
    .map((block) => Decoration.widget({ widget: new BlockControlsWidget(block.from, block.kind, block.key === active?.key, language), side: -1 }).range(block.from));
  return Decoration.set(decorations, true);
}

export function blockControlsExtension(language: Language): Extension {
  let dragSourceFrom: number | null = null;
  const controls = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = blockControlDecorations(view, language); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) this.decorations = blockControlDecorations(update.view, language);
    }
  }, {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousedown(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target?.closest(".cm-block-controls")) return false;
        event.preventDefault();
        return true;
      },
      click(event, view) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const controlsElement = target?.closest<HTMLElement>("[data-block-from]");
        if (!controlsElement) return false;
        const from = Number(controlsElement.dataset.blockFrom);
        const action = target?.closest<HTMLElement>("[data-block-action]")?.dataset.blockAction;
        if (action) { event.preventDefault(); controlsElement.classList.remove("menu-open"); return runAction(view, from, action); }
        if (target?.closest(".cm-block-handle")) {
          event.preventDefault();
          view.dom.querySelectorAll(".cm-block-controls.menu-open").forEach((element) => { if (element !== controlsElement) element.classList.remove("menu-open"); });
          controlsElement.classList.toggle("menu-open");
          return true;
        }
        return false;
      },
      dragstart(event, view) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const controlsElement = target?.closest<HTMLElement>("[data-block-from]");
        if (!controlsElement || !target?.closest(".cm-block-handle") || !event.dataTransfer || view.composing) return false;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(BLOCK_MIME, controlsElement.dataset.blockFrom ?? "");
        dragSourceFrom = Number(controlsElement.dataset.blockFrom);
        return true;
      },
      dragover(event, view) {
        if (!event.dataTransfer?.types.includes(BLOCK_MIME)) return false;
        event.preventDefault();
        const sourceFrom = dragSourceFrom;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null || sourceFrom === null || !Number.isFinite(sourceFrom)) return true;
        const blocks = buildBlockGraph(view.state);
        const source = blockAtPosition(blocks, sourceFrom);
        const target = blockAtPosition(blocks, position);
        if (!source || !target || source.parentKey !== target.parentKey) {
          view.dispatch({ effects: dropTargetEffect.of(null) });
          return true;
        }
        const start = view.coordsAtPos(target.from);
        const end = view.coordsAtPos(target.to);
        const side = event.clientY > ((start?.top ?? event.clientY) + (end?.bottom ?? event.clientY)) / 2 ? "after" : "before";
        view.dispatch({ effects: dropTargetEffect.of({ position: side === "before" ? target.from : target.to, side }) });
        return true;
      },
      drop(event, view) {
        if (!event.dataTransfer?.types.includes(BLOCK_MIME)) return false;
        event.preventDefault();
        const sourceFrom = dragSourceFrom ?? Number(event.dataTransfer.getData(BLOCK_MIME));
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        view.dispatch({ effects: dropTargetEffect.of(null) });
        dragSourceFrom = null;
        if (position === null || !Number.isFinite(sourceFrom)) return true;
        const blocks = buildBlockGraph(view.state);
        const source = blockAtPosition(blocks, sourceFrom);
        const target = blockAtPosition(blocks, position);
        if (!source || !target || source.parentKey !== target.parentKey) return true;
        const siblings = siblingsFor(blocks, source);
        const sourceIndex = siblings.findIndex((block) => block.key === source.key);
        const targetIndex = siblings.findIndex((block) => block.key === target.key);
        const start = view.coordsAtPos(target.from);
        const end = view.coordsAtPos(target.to);
        const after = event.clientY > ((start?.top ?? event.clientY) + (end?.bottom ?? event.clientY)) / 2;
        const destination = after ? targetIndex + (sourceIndex > targetIndex ? 1 : 0) : targetIndex - (sourceIndex < targetIndex ? 1 : 0);
        applyEdit(view, moveBlockToIndex(view.state, sourceFrom, destination), "move.block.drop");
        return true;
      },
      dragend(_event, view) { dragSourceFrom = null; view.dispatch({ effects: dropTargetEffect.of(null) }); return false; },
    },
  });

  return [
    dropTargetField,
    controls,
    keymap.of([
      { key: "Mod-Shift-ArrowUp", run: (view) => applyEdit(view, moveBlock(view.state, view.state.selection.main.head, -1), "move.block") },
      { key: "Mod-Shift-ArrowDown", run: (view) => applyEdit(view, moveBlock(view.state, view.state.selection.main.head, 1), "move.block") },
    ]),
  ];
}
