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
  change: DocumentChange;
  anchor: number;
  head: number;
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
  return blocks.filter((candidate) => candidate.parentKey === block.parentKey).sort((left, right) => left.from - right.from);
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

function plainBlockText(state: EditorState, block: BlockRef): string | null {
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
