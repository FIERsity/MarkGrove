import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type BlockKind = "paragraph" | "heading" | "list" | "list-item" | "blockquote" | "code" | "math" | "table" | "horizontal-rule" | "html";
export type ConvertibleBlockKind = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bullet" | "ordered" | "task" | "blockquote" | "code" | "math";

export interface BlockRef {
  key: string;
  kind: BlockKind;
  from: number;
  to: number;
  parentKey: string;
  parentFrom: number;
  parentTo: number;
  depth: number;
  nodeName: string;
  headingLevel?: number;
  markerFrom?: number;
  markerTo?: number;
}

export interface OutlineEntry {
  from: number;
  to: number;
  level: number;
  text: string;
  parentFrom: number | null;
}

export interface DocumentChange {
  from: number;
  to: number;
  insert: string;
}

export interface StructureEdit {
  change: DocumentChange | DocumentChange[];
  anchor: number;
  head: number;
}

export type DropAction = "reorder" | "convert-to-list-item" | "unwrap-to-document" | "join-list";
export type DropHint = "reorder" | "become-list-item" | "leave-list" | "join-list" | "forbidden" | "noop";
export type DropStatus = "legal" | "forbidden" | "noop";

export interface DropDestination {
  action: DropAction;
  parentKey: string;
  index: number;
}

export interface DropPick {
  dest: DropDestination;
  pos: number;
  side: "before" | "after";
  status: DropStatus;
  hint: DropHint;
}

export interface BlockBox {
  top: number;
  bottom: number;
}

function kindForNode(name: string): { kind: BlockKind; headingLevel?: number } | null {
  const atx = /^ATXHeading([1-6])$/.exec(name);
  if (atx) return { kind: "heading", headingLevel: Number(atx[1]) };
  const setext = /^SetextHeading([12])$/.exec(name);
  if (setext) return { kind: "heading", headingLevel: Number(setext[1]) };
  if (name === "Paragraph") return { kind: "paragraph" };
  if (name === "Blockquote") return { kind: "blockquote" };
  if (name === "FencedCode" || name === "CodeBlock") return { kind: "code" };
  if (name === "DisplayMath") return { kind: "math" };
  if (name === "Table") return { kind: "table" };
  if (name === "HorizontalRule") return { kind: "horizontal-rule" };
  if (name === "HTMLBlock") return { kind: "html" };
  return null;
}

function listChildren(list: SyntaxNode): SyntaxNode[] {
  const items: SyntaxNode[] = [];
  for (let child = list.firstChild; child; child = child.nextSibling) if (child.name === "ListItem") items.push(child);
  return items;
}

function nestedLists(item: SyntaxNode): SyntaxNode[] {
  const lists: SyntaxNode[] = [];
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === "BulletList" || child.name === "OrderedList") lists.push(child);
  }
  return lists;
}

export function buildBlockGraph(state: EditorState): BlockRef[] {
  const blocks: BlockRef[] = [];
  const root = syntaxTree(state).topNode;

  function addList(list: SyntaxNode, depth: number) {
    const parentKey = `list:${list.from}:${list.to}`;
    for (const item of listChildren(list)) {
      const marker = item.getChild("ListMark");
      blocks.push({
        key: `list-item:${item.from}:${item.to}`,
        kind: "list-item",
        from: item.from,
        to: item.to,
        parentKey,
        parentFrom: list.from,
        parentTo: list.to,
        depth,
        nodeName: item.name,
        markerFrom: marker?.from,
        markerTo: marker?.to,
      });
      for (const nested of nestedLists(item)) addList(nested, depth + 1);
    }
  }

  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.name === "BulletList" || child.name === "OrderedList") {
      blocks.push({
        key: `list:${child.from}:${child.to}`,
        kind: "list",
        from: child.from,
        to: child.to,
        parentKey: "document",
        parentFrom: root.from,
        parentTo: root.to,
        depth: 0,
        nodeName: child.name,
      });
      addList(child, 1);
      continue;
    }
    const descriptor = kindForNode(child.name);
    if (!descriptor) continue;
    blocks.push({
      key: `${descriptor.kind}:${child.from}:${child.to}`,
      ...descriptor,
      from: child.from,
      to: child.to,
      parentKey: "document",
      parentFrom: root.from,
      parentTo: root.to,
      depth: 0,
      nodeName: child.name,
    });
  }
  return blocks.sort((left, right) => left.from - right.from || right.depth - left.depth || left.to - right.to);
}

export function blockAtPosition(blocks: readonly BlockRef[], position: number): BlockRef | null {
  const matches = blocks.filter((block) => position >= block.from && position <= block.to);
  return matches.sort((left, right) => right.depth - left.depth || Number(right.from === position) - Number(left.from === position) || (left.to - left.from) - (right.to - right.from))[0] ?? null;
}

export function siblingsFor(blocks: readonly BlockRef[], block: BlockRef): BlockRef[] {
  return siblingsByParent(blocks, block.parentKey);
}

export function siblingsByParent(blocks: readonly BlockRef[], parentKey: string): BlockRef[] {
  return blocks.filter((candidate) => candidate.parentKey === parentKey).sort((left, right) => left.from - right.from);
}

export function documentBlocks(blocks: readonly BlockRef[]): BlockRef[] {
  return siblingsByParent(blocks, "document");
}

export function canConvertToListItem(block: BlockRef): boolean {
  return block.kind === "paragraph" || block.kind === "heading";
}

export function canEnterListAsItem(block: BlockRef): boolean {
  return block.kind === "list-item" || canConvertToListItem(block);
}

function selectionInside(state: EditorState, block: BlockRef): { anchorOffset: number; headOffset: number } {
  const selection = state.selection.main;
  return {
    anchorOffset: Math.max(0, Math.min(block.to - block.from, selection.anchor - block.from)),
    headOffset: Math.max(0, Math.min(block.to - block.from, selection.head - block.from)),
  };
}

function payloadInSlot(state: EditorState, source: BlockRef, slot: BlockRef): string {
  const text = state.doc.sliceString(source.from, source.to);
  if (source.kind !== "list-item" || slot.kind !== "list-item" || source.markerFrom === undefined || source.markerTo === undefined || slot.markerFrom === undefined || slot.markerTo === undefined) return text;
  const sourceLine = state.doc.lineAt(source.markerTo);
  const slotLine = state.doc.lineAt(slot.markerTo);
  let sourceContentStart = source.markerTo;
  let slotContentStart = slot.markerTo;
  while (sourceContentStart < sourceLine.to && /[ \t]/.test(state.doc.sliceString(sourceContentStart, sourceContentStart + 1))) sourceContentStart += 1;
  while (slotContentStart < slotLine.to && /[ \t]/.test(state.doc.sliceString(slotContentStart, slotContentStart + 1))) slotContentStart += 1;
  const sourceColumn = sourceContentStart - source.from;
  const slotColumn = slotContentStart - slot.from;
  const prefix = state.doc.sliceString(slot.markerFrom, slotContentStart);
  const lines = text.split("\n");
  lines[0] = `${lines[0]!.slice(0, source.markerFrom - source.from)}${prefix}${lines[0]!.slice(sourceColumn)}`;
  if (sourceColumn !== slotColumn) {
    for (let index = 1; index < lines.length; index += 1) {
      const spaces = /^ */.exec(lines[index]!)?.[0].length ?? 0;
      if (spaces >= sourceColumn) lines[index] = `${" ".repeat(slotColumn)}${lines[index]!.slice(sourceColumn)}`;
    }
  }
  return lines.join("\n");
}

export function moveBlockToIndex(state: EditorState, position: number, destinationIndex: number): StructureEdit | null {
  const blocks = buildBlockGraph(state);
  const block = blockAtPosition(blocks, position);
  if (!block) return null;
  const siblings = siblingsFor(blocks, block);
  const sourceIndex = siblings.findIndex((candidate) => candidate.key === block.key);
  if (sourceIndex < 0 || destinationIndex < 0 || destinationIndex >= siblings.length || sourceIndex === destinationIndex) return null;

  const startIndex = Math.min(sourceIndex, destinationIndex);
  const endIndex = Math.max(sourceIndex, destinationIndex);
  const affected = siblings.slice(startIndex, endIndex + 1);
  const ordered = [...affected];
  const separators = affected.slice(0, -1).map((item, index) => state.doc.sliceString(item.to, affected[index + 1]!.from));
  const localSource = sourceIndex - startIndex;
  const localDestination = destinationIndex - startIndex;
  const [moved] = ordered.splice(localSource, 1);
  ordered.splice(localDestination, 0, moved!);
  const payloads = ordered.map((item, index) => payloadInSlot(state, item, affected[index]!));

  let insert = "";
  const starts: number[] = [];
  for (let index = 0; index < payloads.length; index += 1) {
    starts.push(insert.length);
    insert += payloads[index];
    if (index < separators.length) insert += separators[index];
  }
  const offsets = selectionInside(state, block);
  const newFrom = affected[0]!.from + starts[localDestination]!;
  const movedLength = payloads[localDestination]!.length;
  return {
    change: { from: affected[0]!.from, to: affected.at(-1)!.to, insert },
    anchor: newFrom + Math.min(movedLength, offsets.anchorOffset),
    head: newFrom + Math.min(movedLength, offsets.headOffset),
  };
}

function moveSelectedSiblingRange(state: EditorState, direction: -1 | 1): StructureEdit | null {
  const selection = state.selection.main;
  if (selection.empty) return null;
  const blocks = buildBlockGraph(state);
  const probe = Math.max(selection.from, selection.to - 1);
  const active = blockAtPosition(blocks, probe);
  if (!active) return null;
  const siblings = siblingsFor(blocks, active);
  const selected = siblings.filter((block) => selection.from < block.to && selection.to > block.from);
  if (selected.length < 2) return null;
  const startIndex = siblings.findIndex((block) => block.key === selected[0]!.key);
  const endIndex = siblings.findIndex((block) => block.key === selected.at(-1)!.key);
  if (startIndex < 0 || endIndex - startIndex + 1 !== selected.length) return null;
  if ((direction < 0 && startIndex === 0) || (direction > 0 && endIndex === siblings.length - 1)) return null;

  const affectedStart = direction < 0 ? startIndex - 1 : startIndex;
  const affectedEnd = direction < 0 ? endIndex : endIndex + 1;
  const affected = siblings.slice(affectedStart, affectedEnd + 1);
  const ordered = direction < 0
    ? [...affected.slice(1), affected[0]!]
    : [affected.at(-1)!, ...affected.slice(0, -1)];
  const payloads = ordered.map((item, index) => payloadInSlot(state, item, affected[index]!));
  const separators = affected.slice(0, -1).map((item, index) => state.doc.sliceString(item.to, affected[index + 1]!.from));
  let insert = "";
  const starts: number[] = [];
  for (let index = 0; index < payloads.length; index += 1) {
    starts.push(insert.length);
    insert += payloads[index];
    if (index < separators.length) insert += separators[index];
  }

  const newSelectedIndex = direction < 0 ? 0 : 1;
  const selectedLength = selected.reduce((total, _block, index) => total + payloads[newSelectedIndex + index]!.length + (index < selected.length - 1 ? separators[newSelectedIndex + index]!.length : 0), 0);
  const oldSelectedFrom = selected[0]!.from;
  const newSelectedFrom = affected[0]!.from + starts[newSelectedIndex]!;
  return {
    change: { from: affected[0]!.from, to: affected.at(-1)!.to, insert },
    anchor: newSelectedFrom + Math.min(selectedLength, Math.max(0, selection.anchor - oldSelectedFrom)),
    head: newSelectedFrom + Math.min(selectedLength, Math.max(0, selection.head - oldSelectedFrom)),
  };
}

export function moveSingleBlock(state: EditorState, position: number, direction: -1 | 1): StructureEdit | null {
  const blocks = buildBlockGraph(state);
  const block = blockAtPosition(blocks, position);
  if (!block) return null;
  const siblings = siblingsFor(blocks, block);
  const index = siblings.findIndex((candidate) => candidate.key === block.key);
  return moveBlockToIndex(state, position, index + direction);
}

export function moveBlock(state: EditorState, position: number, direction: -1 | 1): StructureEdit | null {
  const selection = state.selection.main;
  if (!selection.empty && position >= selection.from && position <= selection.to) return moveSelectedSiblingRange(state, direction);
  return moveSingleBlock(state, position, direction);
}

function insertionSeparator(state: EditorState, block: BlockRef, siblings: readonly BlockRef[]): string {
  const index = siblings.findIndex((candidate) => candidate.key === block.key);
  const next = siblings[index + 1];
  if (next) return state.doc.sliceString(block.to, next.from);
  const previous = siblings[index - 1];
  if (previous) return state.doc.sliceString(previous.to, block.from);
  return block.parentKey === "document" ? "\n\n" : "\n";
}

export function duplicateBlock(state: EditorState, position: number): StructureEdit | null {
  const blocks = buildBlockGraph(state);
  const block = blockAtPosition(blocks, position);
  if (!block) return null;
  const text = state.doc.sliceString(block.from, block.to);
  const separator = insertionSeparator(state, block, siblingsFor(blocks, block));
  const insert = `${separator}${text}`;
  return {
    change: { from: block.to, to: block.to, insert },
    anchor: block.to + separator.length,
    head: block.to + separator.length + text.length,
  };
}

export function deleteBlock(state: EditorState, position: number): StructureEdit | null {
  const blocks = buildBlockGraph(state);
  const block = blockAtPosition(blocks, position);
  if (!block) return null;
  const siblings = siblingsFor(blocks, block);
  const index = siblings.findIndex((candidate) => candidate.key === block.key);
  const next = siblings[index + 1];
  const previous = siblings[index - 1];
  const from = previous && !next ? previous.to : block.from;
  const to = next ? next.from : block.to;
  return { change: { from, to, insert: "" }, anchor: from, head: from };
}

export function plainBlockText(state: EditorState, block: BlockRef): string | null {
  const text = state.doc.sliceString(block.from, block.to);
  if (block.kind === "paragraph") return text;
  if (block.kind === "heading") {
    if (block.nodeName.startsWith("ATX")) return text.replace(/^#{1,6}[ \t]+/, "").replace(/[ \t]+#+[ \t]*$/, "");
    return text.replace(/\n(?:=+|-+)[ \t]*$/, "");
  }
  if (block.kind === "list-item") {
    if (text.includes("\n")) return null;
    return text.replace(/^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, "");
  }
  if (block.kind === "blockquote") return text.split("\n").map((line) => line.replace(/^>[ \t]?/, "")).join("\n");
  if (block.kind === "code") return text.replace(/^```[^\n]*\n?/, "").replace(/\n?```[ \t]*$/, "");
  if (block.kind === "math") return text.replace(/^\$\$[ \t]*\n?/, "").replace(/\n?\$\$[ \t]*$/, "");
  return null;
}

export function convertBlock(state: EditorState, position: number, target: ConvertibleBlockKind): StructureEdit | null {
  const block = blockAtPosition(buildBlockGraph(state), position);
  if (!block) return null;
  const plain = plainBlockText(state, block);
  if (plain === null) return null;
  const insert = target === "paragraph" ? plain
    : target === "heading-1" ? `# ${plain}`
    : target === "heading-2" ? `## ${plain}`
    : target === "heading-3" ? `### ${plain}`
    : target === "bullet" ? `- ${plain}`
    : target === "ordered" ? `1. ${plain}`
    : target === "task" ? `- [ ] ${plain}`
    : target === "blockquote" ? plain.split("\n").map((line) => `> ${line}`).join("\n")
    : target === "code" ? `\`\`\`\n${plain}\n\`\`\``
    : `$$\n${plain}\n$$`;
  return { change: { from: block.from, to: block.to, insert }, anchor: block.from + insert.length, head: block.from + insert.length };
}

export function insertionToMoveIndex(sourceIndex: number, insertIndex: number): number | null {
  if (insertIndex === sourceIndex || insertIndex === sourceIndex + 1) return null;
  return insertIndex > sourceIndex ? insertIndex - 1 : insertIndex;
}

function markerText(state: EditorState, block: BlockRef): string {
  if (block.markerFrom === undefined || block.markerTo === undefined) return "";
  return state.doc.sliceString(block.markerFrom, block.markerTo);
}

function contentStartAfterMarker(state: EditorState, block: BlockRef): number {
  if (block.markerTo === undefined) return block.from;
  const line = state.doc.lineAt(block.markerTo);
  let start = block.markerTo;
  while (start < line.to && /[ \t]/.test(state.doc.sliceString(start, start + 1))) start += 1;
  const task = /^\[([ xX])\][ \t]+/.exec(state.doc.sliceString(start, line.to));
  if (task) start += task[0].length;
  return start;
}

function sourceTaskMark(state: EditorState, block: BlockRef): string | null {
  if (block.kind !== "list-item" || block.markerTo === undefined) return null;
  const line = state.doc.lineAt(block.markerTo);
  let start = block.markerTo;
  while (start < line.to && /[ \t]/.test(state.doc.sliceString(start, start + 1))) start += 1;
  const task = /^\[([ xX])\]/.exec(state.doc.sliceString(start, line.to));
  if (!task) return null;
  return task[1] === " " ? "[ ]" : "[x]";
}

function listStyleFromItem(state: EditorState, item: BlockRef): { kind: "bullet" | "ordered" | "task"; bullet: string; delim: "." | ")" } {
  const mark = markerText(state, item).trim();
  const ordered = /^(\d+)([.)])$/.exec(mark);
  const bullet = ordered ? "-" : mark || "-";
  const afterMarkerTask = item.markerTo !== undefined && /^\s*\[[ xX]\]/.test(state.doc.sliceString(item.markerTo, state.doc.lineAt(item.markerTo).to));
  if (ordered && !afterMarkerTask) return { kind: "ordered", bullet: "-", delim: ordered[2] as "." | ")" };
  if (afterMarkerTask) return { kind: "task", bullet, delim: "." };
  return { kind: "bullet", bullet, delim: "." };
}

function orderedNumberForInsert(state: EditorState, items: readonly BlockRef[], destIndex: number): number {
  if (destIndex < items.length) {
    const parsed = parseInt(markerText(state, items[destIndex]!), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (items.length > 0) {
    const neighbor = items[Math.max(0, Math.min(destIndex, items.length) - 1)] ?? items[0]!;
    const parsed = parseInt(markerText(state, neighbor), 10);
    if (Number.isFinite(parsed)) return destIndex >= items.length ? parsed + 1 : parsed;
  }
  return destIndex + 1;
}

function formatListPrefix(state: EditorState, items: readonly BlockRef[], destIndex: number, source: BlockRef): string {
  const neighbor = items[Math.min(destIndex, items.length - 1)] ?? items[0];
  if (!neighbor) return "- ";
  const style = listStyleFromItem(state, neighbor);
  if (style.kind === "ordered") return String(orderedNumberForInsert(state, items, destIndex)) + style.delim + " ";
  if (style.kind === "task") return style.bullet + " " + (sourceTaskMark(state, source) ?? "[ ]") + " ";
  return style.bullet + " ";
}

function wrapPlainAsListItem(prefix: string, plain: string): string {
  const lines = plain.split("\n");
  return [prefix + (lines[0] ?? ""), ...lines.slice(1).map((line) => line.length ? " ".repeat(prefix.length) + line : line)].join("\n");
}

export function unwrapListItemText(state: EditorState, item: BlockRef): string {
  const text = state.doc.sliceString(item.from, item.to);
  if (item.markerFrom === undefined || item.markerTo === undefined) {
    return text.replace(/^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, "");
  }
  const column = contentStartAfterMarker(state, item) - item.from;
  const lines = text.split("\n");
  lines[0] = lines[0]!.slice(Math.max(0, column));
  for (let index = 1; index < lines.length; index += 1) {
    const spaces = /^ */.exec(lines[index]!)?.[0].length ?? 0;
    if (spaces >= column) lines[index] = lines[index]!.slice(column);
  }
  return lines.join("\n").replace(/^\n+|\n+$/g, "");
}

function rewriteListItemPrefix(state: EditorState, source: BlockRef, prefix: string): string {
  const text = state.doc.sliceString(source.from, source.to);
  if (source.markerFrom === undefined || source.markerTo === undefined) return wrapPlainAsListItem(prefix, unwrapListItemText(state, source));
  const sourceColumn = contentStartAfterMarker(state, source) - source.from;
  const slotColumn = prefix.length;
  const lines = text.split("\n");
  lines[0] = prefix + lines[0]!.slice(Math.max(0, sourceColumn));
  if (sourceColumn !== slotColumn) {
    for (let index = 1; index < lines.length; index += 1) {
      const spaces = /^ */.exec(lines[index]!)?.[0].length ?? 0;
      if (spaces >= sourceColumn) lines[index] = " ".repeat(slotColumn) + lines[index]!.slice(sourceColumn);
    }
  }
  return lines.join("\n");
}

function removalRange(blocks: readonly BlockRef[], source: BlockRef): DocumentChange {
  if (source.kind === "list-item") {
    const items = siblingsFor(blocks, source);
    if (items.length === 1) {
      const list = blocks.find((block) => block.key === source.parentKey);
      if (list) return removalRange(blocks, list);
    }
  }
  const siblings = siblingsFor(blocks, source);
  const index = siblings.findIndex((block) => block.key === source.key);
  const next = siblings[index + 1];
  const previous = siblings[index - 1];
  const from = previous && !next ? previous.to : source.from;
  const to = next ? next.from : source.to;
  return { from, to, insert: "" };
}

function insertionPoint(state: EditorState, destParentKey: string, destIndex: number, payload: string, destKind: "document" | "list-item", blocks: readonly BlockRef[]): DocumentChange {
  const siblings = siblingsByParent(blocks, destParentKey);
  const sep = destKind === "document" ? "\n\n" : "\n";
  if (siblings.length === 0) return { from: 0, to: 0, insert: payload };
  if (destIndex <= 0) return { from: siblings[0]!.from, to: siblings[0]!.from, insert: payload + sep };
  if (destIndex >= siblings.length) return { from: siblings.at(-1)!.to, to: siblings.at(-1)!.to, insert: sep + payload };
  const previous = siblings[destIndex - 1]!;
  const next = siblings[destIndex]!;
  const existing = state.doc.sliceString(previous.to, next.from);
  return { from: next.from, to: next.from, insert: payload + (existing || sep) };
}

function destinationFor(source: BlockRef, parentKey: string): DropDestination["action"] | null {
  if (parentKey === source.parentKey) return "reorder";
  if (parentKey === "document" && source.kind === "list-item") return "unwrap-to-document";
  if (parentKey.startsWith("list:") && canConvertToListItem(source)) return "convert-to-list-item";
  if (parentKey.startsWith("list:") && source.kind === "list-item") return "join-list";
  return null;
}

function makePick(source: BlockRef, parentKey: string, insertIndex: number, side: "before" | "after", pos: number, blocks: readonly BlockRef[]): DropPick {
  const action = destinationFor(source, parentKey);
  const dest: DropDestination = { action: action ?? "reorder", parentKey, index: insertIndex };
  if (!action) return { dest, pos, side, status: "forbidden", hint: "forbidden" };
  if (action === "reorder") {
    const siblings = siblingsByParent(blocks, parentKey);
    const sourceIndex = siblings.findIndex((block) => block.key === source.key);
    if (sourceIndex >= 0 && insertionToMoveIndex(sourceIndex, insertIndex) === null) return { dest, pos, side, status: "noop", hint: "noop" };
  }
  const hint: DropHint = action === "convert-to-list-item" ? "become-list-item" : action === "unwrap-to-document" ? "leave-list" : action === "join-list" ? "join-list" : "reorder";
  return { dest, pos, side, status: "legal", hint };
}

function siblingIndex(siblings: readonly BlockRef[], block: BlockRef): number {
  return siblings.findIndex((candidate) => candidate.key === block.key);
}

function pickAmongSiblings(
  source: BlockRef,
  siblings: readonly BlockRef[],
  parentKey: string,
  y: number,
  boxOf: (block: BlockRef) => BlockBox | null,
  blocks: readonly BlockRef[],
  allowEnterList: boolean,
): DropPick | null {
  const boxes = siblings
    .map((block) => ({ block, box: boxOf(block) }))
    .filter((entry): entry is { block: BlockRef; box: BlockBox } => entry.box !== null);
  if (boxes.length === 0) return null;
  const first = boxes[0]!;
  const last = boxes.at(-1)!;
  if (y < first.box.top) return makePick(source, parentKey, siblingIndex(siblings, first.block), "before", first.block.from, blocks);
  if (y > last.box.bottom) return makePick(source, parentKey, siblingIndex(siblings, last.block) + 1, "after", last.block.to, blocks);

  for (let index = 0; index < boxes.length; index += 1) {
    const current = boxes[index]!;
    const next = boxes[index + 1];
    const top = current.box.top;
    const bottom = current.box.bottom;
    if (y >= top && y <= bottom) {
      if (allowEnterList && current.block.kind === "list") {
        const edge = Math.min(12, Math.max(6, (bottom - top) * 0.18));
        if (y <= top + edge) return makePick(source, parentKey, siblingIndex(siblings, current.block), "before", current.block.from, blocks);
        if (y >= bottom - edge) return makePick(source, parentKey, siblingIndex(siblings, current.block) + 1, "after", current.block.to, blocks);
        const items = siblingsByParent(blocks, current.block.key);
        if (items.length > 0) return pickAmongSiblings(source, items, current.block.key, y, boxOf, blocks, false);
        return { dest: { action: "reorder", parentKey, index: siblingIndex(siblings, current.block) + 1 }, pos: current.block.to, side: "after", status: "forbidden", hint: "forbidden" };
      }
      const after = y > (top + bottom) / 2;
      return makePick(source, parentKey, siblingIndex(siblings, current.block) + (after ? 1 : 0), after ? "after" : "before", after ? current.block.to : current.block.from, blocks);
    }
    if (next && y > bottom && y < next.box.top) return makePick(source, parentKey, siblingIndex(siblings, next.block), "after", current.block.to, blocks);
  }
  return null;
}

export function pickDropDestination(
  source: BlockRef,
  blocks: readonly BlockRef[],
  y: number,
  boxOf: (block: BlockRef) => BlockBox | null,
): DropPick | null {
  const docs = documentBlocks(blocks);
  if (docs.length === 0) return null;
  return pickAmongSiblings(source, docs, "document", y, boxOf, blocks, true);
}

function relocate(state: EditorState, source: BlockRef, destParentKey: string, destIndex: number, payload: string, destKind: "document" | "list-item"): StructureEdit | null {
  const blocks = buildBlockGraph(state);
  const removal = removalRange(blocks, source);
  const insertion = insertionPoint(state, destParentKey, destIndex, payload, destKind, blocks);
  const payloadOffset = Math.max(0, insertion.insert.indexOf(payload));
  if (insertion.from >= removal.from && insertion.from < removal.to) {
    return {
      change: { from: removal.from, to: removal.to, insert: insertion.insert },
      anchor: removal.from + payloadOffset,
      head: removal.from + payloadOffset + payload.length,
    };
  }
  const changes = insertion.from <= removal.from ? [insertion, removal] : [removal, insertion];
  const start = insertion.from <= removal.from ? insertion.from + payloadOffset : insertion.from - (removal.to - removal.from) + payloadOffset;
  return { change: changes, anchor: start, head: start + payload.length };
}

export function dropBlock(state: EditorState, sourceFrom: number, dest: DropDestination): StructureEdit | null {
  const blocks = buildBlockGraph(state);
  const source = blockAtPosition(blocks, sourceFrom);
  if (!source) return null;
  const expected = destinationFor(source, dest.parentKey);
  if (!expected || expected !== dest.action) return null;

  if (dest.action === "reorder") {
    const siblings = siblingsFor(blocks, source);
    const sourceIndex = siblings.findIndex((block) => block.key === source.key);
    const moveIndex = insertionToMoveIndex(sourceIndex, dest.index);
    if (sourceIndex < 0 || moveIndex === null) return null;
    return moveBlockToIndex(state, sourceFrom, moveIndex);
  }

  if (dest.action === "convert-to-list-item") {
    const items = siblingsByParent(blocks, dest.parentKey);
    const plain = plainBlockText(state, source);
    if (items.length === 0 || plain === null) return null;
    return relocate(state, source, dest.parentKey, dest.index, wrapPlainAsListItem(formatListPrefix(state, items, dest.index, source), plain), "list-item");
  }

  if (dest.action === "unwrap-to-document") {
    return relocate(state, source, "document", dest.index, unwrapListItemText(state, source), "document");
  }

  const items = siblingsByParent(blocks, dest.parentKey);
  if (items.length === 0) return null;
  return relocate(state, source, dest.parentKey, dest.index, rewriteListItemPrefix(state, source, formatListPrefix(state, items, dest.index, source)), "list-item");
}
export function buildOutline(state: EditorState): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const stack: OutlineEntry[] = [];
  for (const block of buildBlockGraph(state)) {
    if (block.kind !== "heading" || !block.headingLevel) continue;
    const source = state.doc.sliceString(block.from, block.to);
    const text = block.nodeName.startsWith("ATX")
      ? source.replace(/^#{1,6}[ \t]+/, "").replace(/[ \t]+#+[ \t]*$/, "").trim()
      : source.replace(/\n(?:=+|-+)[ \t]*$/, "").trim();
    while (stack.length && stack.at(-1)!.level >= block.headingLevel) stack.pop();
    const entry: OutlineEntry = { from: block.from, to: block.to, level: block.headingLevel, text, parentFrom: stack.at(-1)?.from ?? null };
    entries.push(entry);
    stack.push(entry);
  }
  return entries;
}
