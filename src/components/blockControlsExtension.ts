import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Language } from "../types";
import {
  blockAtPosition, buildBlockGraph, convertBlock, deleteBlock, dropBlock, duplicateBlock, moveBlock, moveSingleBlock, pickDropDestination,
  type BlockBox, type BlockKind, type BlockRef, type ConvertibleBlockKind, type DropHint, type DropPick, type DropStatus, type StructureEdit,
} from "../lib/documentStructure";

const DRAG_THRESHOLD = 4;

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

interface PointerSession {
  down(event: PointerEvent, from: number, view: EditorView, handle: HTMLElement): void;
}

class BlockControlsWidget extends WidgetType {
  readonly from: number;
  readonly kind: BlockKind;
  readonly active: boolean;
  readonly language: Language;
  readonly pointers: PointerSession;
  constructor(from: number, kind: BlockKind, active: boolean, language: Language, pointers: PointerSession) {
    super();
    this.from = from;
    this.kind = kind;
    this.active = active;
    this.language = language;
    this.pointers = pointers;
  }
  eq(other: BlockControlsWidget) {
    return other.from === this.from && other.kind === this.kind && other.active === this.active && other.language === this.language;
  }
  toDOM(view: EditorView) {
    const controls = document.createElement("span");
    controls.className = `cm-block-controls${this.active ? " active" : ""}`;
    controls.contentEditable = "false";
    controls.dataset.blockFrom = String(this.from);

    const add = document.createElement("button");
    add.type = "button"; add.className = "cm-block-add"; add.dataset.blockAction = "insert"; add.textContent = "+";
    add.setAttribute("aria-label", this.language === "zh" ? "在下方插入段落" : "Insert paragraph below");

    const handle = document.createElement("button");
    handle.type = "button"; handle.className = "cm-block-handle"; handle.textContent = "⠿";
    const kind = kindLabels[this.kind][this.language];
    handle.setAttribute("aria-label", this.language === "zh" ? `${kind}操作与拖动` : `${kind} actions and drag handle`);
    handle.addEventListener("pointerdown", (event) => this.pointers.down(event, this.from, view, handle));

    controls.append(add, handle);
    return controls;
  }
  ignoreEvent(event: Event) {
    return /^(mouse|pointer|touch|drag)/.test(event.type);
  }
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

function blockControlDecorations(view: EditorView, language: Language, pointers: PointerSession): DecorationSet {
  const active = blockAtPosition(buildBlockGraph(view.state), view.state.selection.main.head);
  const decorations = buildBlockGraph(view.state)
    .filter((block) => block.kind !== "list" && view.visibleRanges.some((range) => block.from <= range.to && block.to >= range.from))
    .map((block) => Decoration.widget({ widget: new BlockControlsWidget(block.from, block.kind, block.key === active?.key, language, pointers), side: -1 }).range(block.from));
  return Decoration.set(decorations, true);
}

function blockBox(view: EditorView, block: BlockRef): BlockBox | null {
  const last = Math.max(block.from, Math.min(block.to - (block.to > block.from ? 1 : 0), view.state.doc.length));
  try {
    const start = view.lineBlockAt(block.from);
    const end = view.lineBlockAt(last);
    const top = view.documentTop + Math.min(start.top, end.top);
    const bottom = view.documentTop + Math.max(start.bottom, end.bottom);
    return bottom > top ? { top, bottom } : { top, bottom: top + 18 };
  } catch {
    return null;
  }
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
  document.body.classList.toggle("is-block-dragging", dragging);
}

function autoScroll(view: EditorView, clientY: number) {
  const scroller = view.scrollDOM;
  const rect = scroller.getBoundingClientRect();
  const edge = 48;
  const max = 22;
  if (clientY < rect.top + edge) scroller.scrollTop -= Math.max(4, Math.ceil((1 - Math.max(0, clientY - rect.top) / edge) * max));
  else if (clientY > rect.bottom - edge) scroller.scrollTop += Math.max(4, Math.ceil((1 - Math.max(0, rect.bottom - clientY) / edge) * max));
}

function blockPreviewText(view: EditorView, from: number): string {
  const block = blockAtPosition(buildBlockGraph(view.state), from);
  if (!block) return "";
  return view.state.doc.sliceString(block.from, block.to).split("\n")[0]?.replace(/^#{1,6}[ \t]+/, "").replace(/^[-*+][ \t]+/, "").replace(/^\d+[.)][ \t]+/, "").trim() || "";
}

function liveHandle(view: EditorView, from: number): HTMLElement | null {
  return view.dom.querySelector(`.cm-block-controls[data-block-from="${from}"] .cm-block-handle`);
}

export function blockControlsExtension(language: Language): Extension {
  let dragSourceFrom: number | null = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastSlot = "";
  let lastPick: DropPick | null = null;
  let menuFrom: number | null = null;
  let menuEl: HTMLElement | null = null;
  let menuHandle: HTMLElement | null = null;
  let ghostEl: HTMLElement | null = null;
  let capturedHandle: HTMLElement | null = null;
  let unbindDrag: (() => void) | null = null;

  const showGuide = (view: EditorView, pick: DropPick | null) => {
    const key = slotKey(pick);
    if (key === lastSlot) return;
    lastSlot = key;
    const guide = pick && pick.status !== "noop"
      ? { pos: pick.pos, side: pick.side, hint: pick.hint, status: pick.status, language }
      : null;
    view.dispatch({ effects: dropTargetEffect.of(guide) });
  };

  const removeGhost = () => {
    ghostEl?.remove();
    ghostEl = null;
  };

  const placeGhost = (view: EditorView, clientX: number, clientY: number) => {
    if (!ghostEl) {
      ghostEl = document.createElement("div");
      ghostEl.className = "cm-block-drag-ghost";
      ghostEl.textContent = blockPreviewText(view, dragSourceFrom ?? 0);
      document.body.append(ghostEl);
    }
    ghostEl.style.left = `${clientX + 12}px`;
    ghostEl.style.top = `${clientY + 10}px`;
  };

  const closeMenu = () => {
    menuEl?.remove();
    menuEl = null;
    menuFrom = null;
    menuHandle = null;
    document.querySelectorAll(".cm-block-controls.menu-open").forEach((element) => element.classList.remove("menu-open"));
  };

  const placeMenu = (handle: HTMLElement) => {
    if (!menuEl) return;
    const handleBox = handle.getBoundingClientRect();
    const width = menuEl.offsetWidth;
    const height = menuEl.offsetHeight;
    let left = handleBox.left;
    let top = handleBox.bottom + 6;
    if (top + height > window.innerHeight - 8) top = handleBox.top - height - 6;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  };

  const openMenu = (view: EditorView, from: number, handle: HTMLElement) => {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "cm-block-menu";
    menu.setAttribute("role", "menu");
    const actions: Array<[string, string]> = [
      ["up", language === "zh" ? "上移" : "Move up"],
      ["down", language === "zh" ? "下移" : "Move down"],
      ["duplicate", language === "zh" ? "复制" : "Duplicate"],
      ["delete", language === "zh" ? "删除" : "Delete"],
    ];
    for (const [action, label] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.blockAction = action;
      button.textContent = label;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        closeMenu();
        runAction(view, from, action);
      });
      menu.append(button);
    }
    const separator = document.createElement("span");
    separator.className = "cm-block-menu-label";
    separator.textContent = language === "zh" ? "转换为" : "Turn into";
    menu.append(separator);
    for (const conversion of conversionTargets) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.blockAction = `convert:${conversion.target}`;
      button.textContent = language === "zh" ? conversion.zh : conversion.en;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        closeMenu();
        runAction(view, from, `convert:${conversion.target}`);
      });
      menu.append(button);
    }
    document.body.append(menu);
    menuEl = menu;
    menuFrom = from;
    menuHandle = handle;
    handle.closest(".cm-block-controls")?.classList.add("menu-open");
    placeMenu(handle);
  };

  const finishDrag = (view: EditorView) => {
    unbindDrag?.();
    unbindDrag = null;
    if (capturedHandle) {
      const pointerId = Number(capturedHandle.dataset.pointerId);
      if (Number.isFinite(pointerId) && capturedHandle.hasPointerCapture(pointerId)) capturedHandle.releasePointerCapture(pointerId);
    }
    capturedHandle = null;
    dragSourceFrom = null;
    dragging = false;
    lastSlot = "";
    lastPick = null;
    removeGhost();
    setDragState(view, false);
    view.dispatch({ effects: dropTargetEffect.of(null) });
  };

  const resolvePick = (view: EditorView, sourceFrom: number, clientY: number): DropPick | null => {
    const pick = pickFromPointer(view, sourceFrom, clientY) ?? lastPick;
    if (pick) lastPick = pick;
    return pick;
  };

  const pointers: PointerSession = {
    down(event, from, view, handle) {
      if (event.button !== 0 || view.composing) return;
      event.preventDefault();
      event.stopPropagation();
      try { handle.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
      capturedHandle = handle;
      handle.dataset.pointerId = String(event.pointerId);
      dragSourceFrom = from;
      dragging = false;
      startX = event.clientX;
      startY = event.clientY;
      lastSlot = "";
      lastPick = null;

      const onMove = (moveEvent: PointerEvent) => {
        if (dragSourceFrom === null) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging) {
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          dragging = true;
          closeMenu();
          setDragState(view, true);
        }
        moveEvent.preventDefault();
        autoScroll(view, moveEvent.clientY);
        const pick = resolvePick(view, dragSourceFrom, moveEvent.clientY);
        setDragState(view, true, pick?.status === "forbidden");
        showGuide(view, pick);
        placeGhost(view, moveEvent.clientX, moveEvent.clientY);
      };
      const onUp = (upEvent: PointerEvent) => {
        if (dragSourceFrom === null) return;
        const sourceFrom = dragSourceFrom;
        const wasDragging = dragging;
        const pick = resolvePick(view, sourceFrom, upEvent.clientY);
        finishDrag(view);
        if (wasDragging) {
          if (pick?.status === "legal") applyEdit(view, dropBlock(view.state, sourceFrom, pick.dest), "move.block.drop");
          return;
        }
        const handleNow = liveHandle(view, sourceFrom) ?? handle;
        if (menuFrom === sourceFrom) closeMenu();
        else openMenu(view, sourceFrom, handleNow);
      };
      const onCancel = () => {
        if (dragSourceFrom === null) return;
        finishDrag(view);
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      unbindDrag = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
      };
    },
  };

  const onGlobalPointerDown = (event: Event) => {
    if (menuFrom === null || !menuEl) return;
    const target = event.target;
    if (target instanceof Node && (menuEl.contains(target) || menuHandle?.contains(target))) return;
    closeMenu();
  };

  const onGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || menuFrom === null) return;
    event.preventDefault();
    closeMenu();
  };

  const controls = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
      this.decorations = blockControlDecorations(view, language, pointers);
      window.addEventListener("pointerdown", onGlobalPointerDown, true);
      window.addEventListener("mousedown", onGlobalPointerDown, true);
      window.addEventListener("keydown", onGlobalKeyDown, true);
      window.addEventListener("resize", closeMenu);
      view.scrollDOM.addEventListener("scroll", closeMenu, { passive: true });
    }
    update(update: ViewUpdate) {
      if (dragSourceFrom !== null) return;
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
        this.decorations = blockControlDecorations(update.view, language, pointers);
      }
    }
    destroy() {
      window.removeEventListener("pointerdown", onGlobalPointerDown, true);
      window.removeEventListener("mousedown", onGlobalPointerDown, true);
      window.removeEventListener("keydown", onGlobalKeyDown, true);
      window.removeEventListener("resize", closeMenu);
      this.view.scrollDOM.removeEventListener("scroll", closeMenu);
      if (dragSourceFrom !== null) finishDrag(this.view);
      closeMenu();
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
        if (!action) return false;
        event.preventDefault();
        closeMenu();
        return runAction(view, from, action);
      },
      keydown(event) {
        if (event.key !== "Escape" || menuFrom === null) return false;
        event.preventDefault();
        closeMenu();
        return true;
      },
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
