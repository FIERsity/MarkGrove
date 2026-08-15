import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable,
  useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, FileText, Folder, FolderPlus, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { ROOT_FOLDER_ID, type FolderRecord, type Language, type NoteRecord, type WorkspaceItemKind } from "../types";
import { flattenWorkspaceTree, trashedFolderIds, type TreeNode } from "../lib/workspace";
import { DismissibleMenu } from "./DismissibleMenu";

export interface TreeMoveRequest {
  kind: WorkspaceItemKind;
  id: string;
  parentId: string;
  targetIndex: number;
}

interface Props {
  folders: FolderRecord[];
  notes: NoteRecord[];
  expandedIds: Set<string>;
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  language: Language;
  onExpandedChange: (ids: Set<string>) => void;
  onOpenNote: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onNewNote: (parentId: string) => void;
  onNewFolder: (parentId: string) => void;
  onRename: (kind: WorkspaceItemKind, id: string) => void;
  onMoveDialog: (kind: WorkspaceItemKind, id: string) => void;
  onMove: (request: TreeMoveRequest) => Promise<void>;
  onTrash: (kind: WorkspaceItemKind, id: string) => void;
  onDissolve: (id: string) => void;
}

interface DropPreview extends TreeMoveRequest { overId: string; zone: "before" | "inside" | "after"; }

function activeChildren(parentId: string, folders: FolderRecord[], notes: NoteRecord[], excludeId?: string): Array<{ id: string; kind: WorkspaceItemKind; orderKey: string }> {
  const hidden = trashedFolderIds(folders);
  return [
    ...folders.filter((item) => item.parentId === parentId && item.trashedAt === null && !hidden.has(item.id) && item.id !== excludeId)
      .map((item) => ({ id: item.id, kind: "folder" as const, orderKey: item.orderKey })),
    ...notes.filter((item) => item.parentId === parentId && item.trashedAt === null && !hidden.has(item.parentId) && item.id !== excludeId)
      .map((item) => ({ id: item.id, kind: "note" as const, orderKey: item.orderKey })),
  ].sort((left, right) => left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
}

function computeDrop(
  active: TreeNode,
  over: TreeNode,
  ratio: number,
  folders: FolderRecord[],
  notes: NoteRecord[],
): DropPreview {
  if (over.kind === "folder" && ratio >= 0.2 && ratio <= 0.8) {
    return {
      kind: active.kind, id: active.id, parentId: over.id,
      targetIndex: activeChildren(over.id, folders, notes, active.id).length,
      overId: `${over.kind}:${over.id}`, zone: "inside",
    };
  }
  const siblings = activeChildren(over.parentId, folders, notes, active.id);
  const overIndex = Math.max(0, siblings.findIndex((item) => item.id === over.id && item.kind === over.kind));
  const after = ratio > 0.5;
  return {
    kind: active.kind, id: active.id, parentId: over.parentId,
    targetIndex: overIndex + (after ? 1 : 0), overId: `${over.kind}:${over.id}`, zone: after ? "after" : "before",
  };
}

interface RowProps {
  node: TreeNode;
  selected: boolean;
  focused: boolean;
  preview: DropPreview | null;
  language: Language;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  onOpen: () => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onMoveDialog: () => void;
  onTrash: () => void;
  onDissolve: () => void;
  rowRef: (element: HTMLDivElement | null) => void;
}

function TreeRow(props: RowProps) {
  const { node, selected, focused, preview, language } = props;
  const sortable = useSortable({ id: `${node.kind}:${node.id}`, data: { node } });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const nodeKey = `${node.kind}:${node.id}`;
  const isDropTarget = preview?.overId === nodeKey;
  const dropClass = isDropTarget ? ` drop-${preview.zone}` : "";
  return (
    <div
      ref={(element) => { sortable.setNodeRef(element); props.rowRef(element); }}
      style={{ ...style, "--tree-depth": node.depth } as React.CSSProperties}
      className={`tree-row ${selected ? "selected" : ""}${sortable.isDragging ? " dragging" : ""}${dropClass}`}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-selected={selected}
      aria-expanded={node.kind === "folder" ? node.expanded : undefined}
      tabIndex={focused ? 0 : -1}
      onFocus={props.onFocus}
      onKeyDown={props.onKeyDown}
    >
      <button type="button" tabIndex={-1} className="tree-chevron" aria-label={node.expanded ? "Collapse" : "Expand"} onClick={props.onToggle} disabled={node.kind !== "folder"}>
        {node.kind === "folder" && <ChevronRight size={15} className={node.expanded ? "expanded" : ""} />}
      </button>
      <button
        type="button" className="tree-drag-handle"
        aria-label={language === "zh" ? `移动${node.name}` : `Move ${node.name}`}
        {...sortable.attributes} {...sortable.listeners} tabIndex={-1}
      ><GripVertical size={15} /></button>
      <button type="button" tabIndex={-1} className="tree-label" onClick={props.onOpen}>
        {node.kind === "folder" ? <Folder size={16} /> : <FileText size={15} />}
        <span>{node.name}</span>
      </button>
      {node.kind === "folder" && <button type="button" tabIndex={-1} className="tree-quick-action" aria-label={language === "zh" ? "在此新建笔记" : "New note here"} onClick={props.onNewNote}><Plus size={15} /></button>}
      <DismissibleMenu label={language === "zh" ? "更多" : "More"} className="tree-more" menuClassName="tree-dropdown" align="right" trigger={<MoreHorizontal size={16} />}>
          {node.kind === "folder" && <>
            <button type="button" onClick={props.onNewNote}><Plus size={15} />{language === "zh" ? "新建笔记" : "New note"}</button>
            <button type="button" onClick={props.onNewFolder}><FolderPlus size={15} />{language === "zh" ? "新建子文件夹" : "New subfolder"}</button>
          </>}
          <button type="button" onClick={props.onRename}>{language === "zh" ? "重命名" : "Rename"}</button>
          <button type="button" onClick={props.onMoveDialog}>{language === "zh" ? "移动到…" : "Move to…"}</button>
          {node.kind === "folder" && <button type="button" onClick={props.onDissolve}>{language === "zh" ? "解散文件夹" : "Dissolve folder"}</button>}
          <button type="button" className="danger" onClick={props.onTrash}>{language === "zh" ? "移到回收站" : "Move to trash"}</button>
      </DismissibleMenu>
      {isDropTarget && preview?.zone === "inside" && <span className="tree-drop-label">{language === "zh" ? `移入“${node.name}”` : `Move into “${node.name}”`}</span>}
    </div>
  );
}

function RootDropZone({ active, language }: { active: boolean; language: Language }) {
  const droppable = useDroppable({ id: "root-drop-zone", data: { root: true } });
  return <div ref={droppable.setNodeRef} className={`tree-root-drop${active ? " active" : ""}`} aria-label={language === "zh" ? "移到我的墨林" : "Move to my grove"}>{language === "zh" ? "移到我的墨林" : "Move to my grove"}</div>;
}

export function WorkspaceTree(props: Props) {
  const nodes = useMemo(() => flattenWorkspaceTree(props.folders, props.notes, props.expandedIds), [props.expandedIds, props.folders, props.notes]);
  const nodeByKey = useMemo(() => new Map(nodes.map((node) => [`${node.kind}:${node.id}`, node])), [nodes]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(props.selectedNoteId ?? props.selectedFolderId ?? nodes[0]?.id ?? null);
  const [keyboardMove, setKeyboardMove] = useState<TreeMoveRequest | null>(null);
  const expandTimer = useRef<number | null>(null);
  const expandTargetRef = useRef<string | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const pointerDragRef = useRef(false);
  const pointerStartYRef = useRef<number | null>(null);
  const dragLayoutRef = useRef(new Map<string, { top: number; height: number }>());
  const treeRef = useRef<HTMLDivElement>(null);
  const dragScrollTopRef = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (focusedId && nodes.some((node) => node.id === focusedId)) return;
    setFocusedId(props.selectedNoteId ?? props.selectedFolderId ?? nodes[0]?.id ?? null);
  }, [focusedId, nodes, props.selectedFolderId, props.selectedNoteId]);
  useEffect(() => () => { if (expandTimer.current !== null) window.clearTimeout(expandTimer.current); }, []);
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent | MouseEvent) => {
      pointerYRef.current = event.clientY;
      if (!pointerDragRef.current) return;
      const tree = treeRef.current;
      if (!tree) return;
      const rect = tree.getBoundingClientRect();
      const edge = 42;
      const maxStep = 16;
      const distance = event.clientY < rect.top + edge
        ? event.clientY - (rect.top + edge)
        : event.clientY > rect.bottom - edge
          ? event.clientY - (rect.bottom - edge)
          : 0;
      if (distance) tree.scrollTop += Math.max(-maxStep, Math.min(maxStep, distance * 0.4));
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  function toggle(node: TreeNode) {
    if (node.kind !== "folder") return;
    const next = new Set(props.expandedIds);
    if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
    props.onExpandedChange(next);
  }

  function open(node: TreeNode) {
    if (node.kind === "folder") {
      if (!props.expandedIds.has(node.id)) toggle(node);
      props.onOpenFolder(node.id);
    } else props.onOpenNote(node.id);
  }

  function focusNode(index: number) {
    const node = nodes[Math.max(0, Math.min(index, nodes.length - 1))];
    if (!node) return;
    setFocusedId(node.id);
    window.requestAnimationFrame(() => rowRefs.current.get(`${node.kind}:${node.id}`)?.focus());
  }

  function handleTreeKey(event: React.KeyboardEvent<HTMLDivElement>, node: TreeNode, index: number) {
    if (keyboardMove?.id === node.id && keyboardMove.kind === node.kind) {
      if (event.key === "Escape") { event.preventDefault(); setKeyboardMove(null); return; }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const request = keyboardMove;
        setKeyboardMove(null);
        void props.onMove(request);
        return;
      }
      const current = activeChildren(keyboardMove.parentId, props.folders, props.notes, node.id);
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const delta = event.key === "ArrowUp" ? -1 : 1;
        setKeyboardMove({ ...keyboardMove, targetIndex: Math.max(0, Math.min(current.length, keyboardMove.targetIndex + delta)) });
        return;
      }
      if (event.key === "ArrowLeft" && keyboardMove.parentId !== "root") {
        event.preventDefault();
        const parent = props.folders.find((folder) => folder.id === keyboardMove.parentId);
        if (parent) {
          const outer = activeChildren(parent.parentId, props.folders, props.notes, node.id);
          const parentIndex = outer.findIndex((item) => item.kind === "folder" && item.id === parent.id);
          setKeyboardMove({ ...keyboardMove, parentId: parent.parentId, targetIndex: Math.max(0, parentIndex + 1) });
        }
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const before = current[keyboardMove.targetIndex - 1];
        if (before?.kind === "folder") {
          setKeyboardMove({ ...keyboardMove, parentId: before.id, targetIndex: activeChildren(before.id, props.folders, props.notes, node.id).length });
          const expanded = new Set(props.expandedIds); expanded.add(before.id); props.onExpandedChange(expanded);
        }
        return;
      }
    }
    if (event.key === "ArrowDown") { event.preventDefault(); focusNode(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusNode(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusNode(0); }
    else if (event.key === "End") { event.preventDefault(); focusNode(nodes.length - 1); }
    else if (event.key === "ArrowRight" && node.kind === "folder") {
      event.preventDefault();
      if (!node.expanded) toggle(node); else if (nodes[index + 1]?.parentId === node.id) focusNode(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.kind === "folder" && node.expanded) toggle(node);
      else {
        const parentIndex = nodes.findIndex((candidate) => candidate.kind === "folder" && candidate.id === node.parentId);
        if (parentIndex >= 0) focusNode(parentIndex);
      }
    } else if (event.key === "Enter") { event.preventDefault(); open(node); }
    else if (event.key === " ") {
      event.preventDefault();
      const siblings = activeChildren(node.parentId, props.folders, props.notes, node.id);
      const sourceIndex = activeChildren(node.parentId, props.folders, props.notes).findIndex((item) => item.id === node.id && item.kind === node.kind);
      setKeyboardMove({ kind: node.kind, id: node.id, parentId: node.parentId, targetIndex: Math.min(sourceIndex, siblings.length) });
    } else if (event.key === "F2") { event.preventDefault(); props.onRename(node.kind, node.id); }
  }

  function clearExpandTimer() {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTimer.current = null;
    expandTargetRef.current = null;
  }

  function updatePreview(event: DragOverEvent) {
    const active = nodeByKey.get(String(event.active.id));
    if (String(event.over?.id) === "root-drop-zone" && active) {
      setPreview({ kind: active.kind, id: active.id, parentId: ROOT_FOLDER_ID, targetIndex: activeChildren(ROOT_FOLDER_ID, props.folders, props.notes, active.id).length, overId: "root-drop-zone", zone: "inside" });
      clearExpandTimer();
      return;
    }
    const over = event.over ? nodeByKey.get(String(event.over.id)) : null;
    if (!active || !over || (active.id === over.id && active.kind === over.kind)) { clearExpandTimer(); setPreview(null); return; }
    const translated = event.active.rect.current.translated;
    const center = pointerDragRef.current && pointerYRef.current !== null
        ? pointerYRef.current
      : translated ? translated.top + translated.height / 2 : event.over!.rect.top + event.over!.rect.height / 2;
    const layout = pointerDragRef.current ? dragLayoutRef.current.get(String(event.over!.id)) : null;
    const scrollDelta = (treeRef.current?.scrollTop ?? dragScrollTopRef.current) - dragScrollTopRef.current;
    const overTop = layout ? layout.top - scrollDelta : event.over!.rect.top;
    const overHeight = layout?.height ?? event.over!.rect.height;
    const ratio = (center - overTop) / Math.max(1, overHeight);
    const next = computeDrop(active, over, ratio, props.folders, props.notes);
    const invalid = active.kind === "folder" && (next.parentId === active.id || isDescendant(next.parentId, active.id, props.folders));
    setPreview(invalid ? null : next);
    if (!invalid && next.zone === "inside" && over.kind === "folder" && !props.expandedIds.has(over.id)) {
      if (expandTargetRef.current !== over.id) {
        if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
        expandTargetRef.current = over.id;
        expandTimer.current = window.setTimeout(() => {
          const expanded = new Set(props.expandedIds); expanded.add(over.id); props.onExpandedChange(expanded);
          expandTimer.current = null;
        }, 500);
      }
    } else {
      clearExpandTimer();
    }
  }

  function finishDrag(event: DragEndEvent) {
    clearExpandTimer();
    const request = preview;
    setActiveKey(null); setPreview(null);
    if (!event.over || !request) return;
    if (request.zone === "inside" && request.parentId !== ROOT_FOLDER_ID) {
      const expanded = new Set(props.expandedIds); expanded.add(request.parentId); props.onExpandedChange(expanded);
    }
    void props.onMove(request);
  }

  const activeNode = activeKey ? nodeByKey.get(activeKey) : null;
  return (
    <DndContext
      sensors={sensors} collisionDetection={(args) => {
        const pointerHits = pointerWithin(args);
        return pointerHits.length > 0 ? pointerHits : closestCenter(args);
      }}
      onDragStart={(event: DragStartEvent) => {
        pointerDragRef.current = !(event.activatorEvent instanceof KeyboardEvent);
        pointerStartYRef.current = pointerDragRef.current && event.activatorEvent instanceof MouseEvent ? event.activatorEvent.clientY : null;
        pointerYRef.current = pointerStartYRef.current;
        dragScrollTopRef.current = treeRef.current?.scrollTop ?? 0;
        dragLayoutRef.current = new Map([...rowRefs.current.entries()].map(([key, element]) => {
          const rect = element.getBoundingClientRect();
          return [key, { top: rect.top, height: rect.height }];
        }));
        setActiveKey(String(event.active.id));
      }}
      onDragMove={(event: DragMoveEvent) => { if (pointerDragRef.current && pointerStartYRef.current !== null) pointerYRef.current = pointerStartYRef.current + event.delta.y; }}
      onDragOver={updatePreview} onDragCancel={() => { clearExpandTimer(); pointerDragRef.current = false; pointerStartYRef.current = null; pointerYRef.current = null; dragLayoutRef.current.clear(); dragScrollTopRef.current = 0; setActiveKey(null); setPreview(null); }} onDragEnd={(event) => { pointerDragRef.current = false; pointerStartYRef.current = null; pointerYRef.current = null; dragLayoutRef.current.clear(); dragScrollTopRef.current = 0; finishDrag(event); }}
      accessibility={{
        screenReaderInstructions: { draggable: props.language === "zh" ? "按空格或回车拾起，方向键移动，再按空格或回车放下，Escape 取消。" : "Press space or enter to pick up, use arrow keys to move, press space or enter to drop, and Escape to cancel." },
        announcements: {
          onDragStart({ active }) {
            const node = nodeByKey.get(String(active.id));
            return props.language === "zh" ? `已拾起${node?.name ?? "项目"}` : `Picked up ${node?.name ?? "item"}`;
          },
          onDragOver({ over }) {
            const node = over ? nodeByKey.get(String(over.id)) : null;
            return node ? (props.language === "zh" ? `当前位置${node.name}` : `Current target ${node.name}`) : undefined;
          },
          onDragEnd({ active, over }) {
            const source = nodeByKey.get(String(active.id)); const target = over ? nodeByKey.get(String(over.id)) : null;
            const inside = preview?.zone === "inside";
            return props.language === "zh"
              ? inside ? `已将${source?.name ?? "项目"}移入${target?.name ?? "目标文件夹"}` : `已将${source?.name ?? "项目"}放到${target?.name ?? "原位置"}`
              : inside ? `Moved ${source?.name ?? "item"} into ${target?.name ?? "the target folder"}` : `Dropped ${source?.name ?? "item"} at ${target?.name ?? "its original position"}`;
          },
          onDragCancel({ active }) {
            const node = nodeByKey.get(String(active.id));
            return props.language === "zh" ? `已取消移动${node?.name ?? "项目"}` : `Cancelled moving ${node?.name ?? "item"}`;
          },
        },
      }}
    >
      <div ref={treeRef} className="workspace-tree" role="tree" aria-label={props.language === "zh" ? "文件夹和笔记" : "Folders and notes"}>
        <RootDropZone active={preview?.overId === "root-drop-zone"} language={props.language} />
        <SortableContext items={nodes.map((node) => `${node.kind}:${node.id}`)} strategy={verticalListSortingStrategy}>
          {nodes.map((node, index) => (
            <div key={`${node.kind}:${node.id}`}>
              <TreeRow
                node={node}
                selected={node.kind === "note" ? props.selectedNoteId === node.id : props.selectedFolderId === node.id}
                focused={focusedId === node.id}
                preview={preview}
                language={props.language}
                onFocus={() => setFocusedId(node.id)}
                onKeyDown={(event) => handleTreeKey(event, node, index)}
                onToggle={() => toggle(node)} onOpen={() => open(node)}
                onNewNote={() => props.onNewNote(node.kind === "folder" ? node.id : node.parentId)}
                onNewFolder={() => props.onNewFolder(node.kind === "folder" ? node.id : node.parentId)}
                onRename={() => props.onRename(node.kind, node.id)}
                onMoveDialog={() => props.onMoveDialog(node.kind, node.id)}
                onTrash={() => props.onTrash(node.kind, node.id)}
                onDissolve={() => { if (node.kind === "folder") props.onDissolve(node.id); }}
                rowRef={(element) => {
                  const key = `${node.kind}:${node.id}`;
                  if (element) rowRefs.current.set(key, element); else rowRefs.current.delete(key);
                }}
              />
            </div>
          ))}
        </SortableContext>
        {nodes.length === 0 && <p className="tree-empty">{props.language === "zh" ? "从一篇新笔记开始" : "Start with a new note"}</p>}
      </div>
      {keyboardMove && <div className="keyboard-move-status" role="status">
        {props.language === "zh" ? `移动位置 ${keyboardMove.targetIndex + 1}。方向键调整，Enter 放下，Esc 取消。` : `Move position ${keyboardMove.targetIndex + 1}. Use arrows, Enter to drop, Escape to cancel.`}
      </div>}
      <DragOverlay>{activeNode && <div className="tree-drag-overlay">{activeNode.kind === "folder" ? <Folder size={16} /> : <FileText size={15} />}{activeNode.name}</div>}</DragOverlay>
    </DndContext>
  );
}

function isDescendant(candidateId: string, folderId: string, folders: FolderRecord[]): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(candidateId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.parentId === folderId) return true;
    visited.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
}
