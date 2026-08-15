import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Language } from "../types";
import {
  blockAtPosition, buildBlockGraph, convertBlock, deleteBlock, dropBlock, duplicateBlock, moveBlock, moveSingleBlock, pickDropDestination,
  type BlockBox, type BlockKind, type BlockRef, type ConvertibleBlockKind, type DropHint, type DropPick, type DropStatus, type StructureEdit,
} from "../lib/documentStructure";

const BLOCK_MIME = "application/x-markgrove-block";

interface DropGuide {
  pos: number;
  side: "before" | "after";
  hint: DropHint;
  status: DropStatus;
  language: Language;
}

const dropTargetEffect = StateEffect.define<DropGuide | null>();

function dropLabel(hint: DropHint, language: Language): string {
  if (hint === "become-list-item") return language === "zh" ? "变成列表项" : "Become a list item";
  if (hint === "leave-list") return language === "zh" ? "移出列表" : "Move out of list";
  if (hint === "join-list") return language === "zh" ? "加入列表" : "Join this list";
  if (hint === "forbidden") return language === "zh" ? "无法放在这里" : "Can't drop here";
  return "";
}

class DropGuideWidget extends WidgetType {
  readonly hint: DropHint;
  readonly status: DropStatus;
  readonly language: Language;
  constructor(hint: DropHint, status: DropStatus, language: Language) {
    super();
    this.hint = hint;
    this.status = status;
    this.language = language;
  }
  eq(other: DropGuideWidget) { return other.hint === this.hint && other.status === this.status && other.language === this.language; }
  toDOM() {
    const guide = document.createElement("div");
    guide.className = `cm-block-drop-guide${this.status === "forbidden" ? " is-forbidden" : this.hint === "reorder" ? "" : " is-convert"}`;
    guide.contentEditable = "false";
    const bar = document.createElement("span");
    bar.className = "cm-block-drop-bar";
    guide.append(bar);
    const label = dropLabel(this.hint, this.language);
    if (label) {
      const text = document.createElement("span");
      text.className = "cm-block-drop-label";
      text.textContent = label;
      guide.append(text);
    }
    return guide;
  }
  ignoreEvent() { return true; }
}

const dropTargetField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(dropTargetEffect)) continue;
      if (!effect.value || effect.value.status === "noop") return Decoration.none;
      return Decoration.set([
        Decoration.widget({
          widget: new DropGuideWidget(effect.value.hint, effect.value.status, effect.value.language),
          side: effect.value.side === "before" ? -1 : 1,
          block: true,
        }).range(effect.value.pos),
      ]);
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
  readonly onDragStart: (event: DragEvent, from: number, view: EditorView) => void;
  constructor(from: number, kind: BlockKind, active: boolean, language: Language, onDragStart: (event: DragEvent, from: number, view: EditorView) => void) {
    super(); this.from = from; this.kind = kind; this.active = active; this.language = language; this.onDragStart = onDragStart;
  }
  eq(other: BlockControlsWidget) { return other.from === this.from && other.kind === this.kind && other.active === this.active && other.language === this.language; }
  toDOM(view: EditorView) {
    const controls = document.createElement("span");
    controls.className = `cm-block-controls${this.active ? " active" : ""}`;
    controls.contentEditable = "false";
    controls.dataset.blockFrom = String(this.from);

    const add = document.createElement("button");
    add.type = "button"; add.className = "cm-block-add"; add.dataset.blockAction = "insert"; add.textContent = "+";
    add.setAttribute("aria-label", this.language === "zh" ? "在下方插入段落" : "Insert paragraph below");

    const handle = document.createElement("button");
    handle.type = "button"; handle.className = "cm-block-handle"; handle.draggable = true; handle.textContent = "⠿";
    handle.addEventListener("dragstart", (event) => this.onDragStart(event, this.from, view));
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
  ignoreEvent(event: Event) { return event.type === "mousedown" || event.type === "dragstart"; }
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

function blockControlDecorations(view: EditorView, language: Language, onDragStart: (event: DragEvent, from: number, view: EditorView) => void): DecorationSet {
  const active = blockAtPosition(buildBlockGraph(view.state), view.state.selection.main.head);
  const decorations = buildBlockGraph(view.state)
    .filter((block) => block.kind !== "list" && view.visibleRanges.some((range) => block.from <= range.to && block.to >= range.from))
    .map((block) => Decoration.widget({ widget: new BlockControlsWidget(block.from, block.kind, block.key === active?.key, language, onDragStart), side: -1 }).range(block.from));
  return Decoration.set(decorations, true);
}

function blockBox(view: EditorView, block: BlockRef): BlockBox | null {
  const start = view.coordsAtPos(block.from);
  const end = view.coordsAtPos(Math.max(block.from, Math.min(block.to, view.state.doc.length)));
  if (!start || !end) return null;
  const top = Math.min(start.top, end.top);
  const bottom = Math.max(start.bottom, end.bottom);
  return bottom > top ? { top, bottom } : { top, bottom: top + 18 };
}

function pickFromPointer(view: EditorView, sourceFrom: number, clientY: number): DropPick | null {
  const blocks = buildBlockGraph(view.state);
  const source = blockAtPosition(blocks, sourceFrom);
  if (!source) return null;
  return pickDropDestination(source, blocks, clientY, (block) => blockBox(view, block));
}

function slotKey(pick: DropPick | null): string {
  if (!pick) return "none";
  return `${pick.dest.parentKey}:${pick.dest.index}:${pick.side}:${pick.status}:${pick.hint}`;
}

function setDragState(view: EditorView, dragging: boolean, forbidden = false) {
  view.dom.classList.toggle("is-block-dragging", dragging);
  view.dom.classList.toggle("is-drop-forbidden", dragging && forbidden);
}

function autoScroll(view: EditorView, clientY: number) {
  const scroller = view.scrollDOM;
  const rect = scroller.getBoundingClientRect();
  const edge = 48;
  const max = 22;
  if (clientY < rect.top + edge) scroller.scrollTop -= Math.max(4, Math.ceil((1 - Math.max(0, clientY - rect.top) / edge) * max));
  else if (clientY > rect.bottom - edge) scroller.scrollTop += Math.max(4, Math.ceil((1 - Math.max(0, rect.bottom - clientY) / edge) * max));
}

export function blockControlsExtension(language: Language): Extension {
  let dragSourceFrom: number | null = null;
  let lastSlot = "";
  const showGuide = (view: EditorView, pick: DropPick | null) => {
    const key = slotKey(pick);
    if (key === lastSlot) return;
    lastSlot = key;
    const guide = pick && pick.status !== "noop"
      ? { pos: pick.pos, side: pick.side, hint: pick.hint, status: pick.status, language }
      : null;
    view.dispatch({ effects: dropTargetEffect.of(guide) });
  };
  const finishDrag = (view: EditorView) => {
    dragSourceFrom = null;
    lastSlot = "";
    setDragState(view, false);
    view.dispatch({ effects: dropTargetEffect.of(null) });
  };
  const onDragStart = (event: DragEvent, from: number, view: EditorView) => {
    if (!event.dataTransfer || view.composing) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BLOCK_MIME, String(from));
    dragSourceFrom = from;
    lastSlot = "";
    view.dom.querySelectorAll(".cm-block-controls.menu-open").forEach((element) => element.classList.remove("menu-open"));
    setDragState(view, true);
  };
  const controls = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = blockControlDecorations(view, language, onDragStart); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) this.decorations = blockControlDecorations(update.view, language, onDragStart);
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
      dragenter(event) {
        if (!event.dataTransfer?.types.includes(BLOCK_MIME)) return false;
        event.preventDefault();
        return true;
      },
      dragover(event, view) {
        if (!event.dataTransfer?.types.includes(BLOCK_MIME)) return false;
        event.preventDefault();
        autoScroll(view, event.clientY);
        const sourceFrom = dragSourceFrom;
        if (sourceFrom === null) {
          event.dataTransfer.dropEffect = "none";
          return true;
        }
        const pick = pickFromPointer(view, sourceFrom, event.clientY);
        event.dataTransfer.dropEffect = pick?.status === "legal" ? "move" : "none";
        setDragState(view, true, pick?.status === "forbidden");
        showGuide(view, pick);
        return true;
      },
      drop(event, view) {
        if (!event.dataTransfer?.types.includes(BLOCK_MIME)) return false;
        event.preventDefault();
        const sourceFrom = dragSourceFrom ?? Number(event.dataTransfer.getData(BLOCK_MIME));
        const pick = Number.isFinite(sourceFrom) ? pickFromPointer(view, sourceFrom, event.clientY) : null;
        finishDrag(view);
        if (pick?.status === "legal") applyEdit(view, dropBlock(view.state, sourceFrom, pick.dest), "move.block.drop");
        return true;
      },
      dragend(_event, view) { finishDrag(view); return false; },
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
