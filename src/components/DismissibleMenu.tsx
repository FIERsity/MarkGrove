import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DISMISSIBLE_MENU_CLOSE_EVENT } from "./menuEvents";

type MenuAlign = "left" | "right";

interface Props {
  label: string;
  children: ReactNode;
  className?: string;
  menuClassName?: string;
  align?: MenuAlign;
  disabled?: boolean;
  trigger: ReactNode;
}

let nextMenuId = 0;
const MENU_OPEN_EVENT = "markgrove-menu-open";

/** A small, accessible menu primitive with document-level dismissal and top-layer positioning. */
export function DismissibleMenu({ label, children, className = "", menuClassName = "", align = "left", disabled, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const idRef = useRef(`markgrove-menu-${++nextMenuId}`);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setPosition(null);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      close();
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      close();
    };
    const onMenuOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== idRef.current) close();
    };
    const onCloseAll = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener(MENU_OPEN_EVENT, onMenuOpen);
    window.addEventListener(DISMISSIBLE_MENU_CLOSE_EVENT, onCloseAll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener(MENU_OPEN_EVENT, onMenuOpen);
      window.removeEventListener(DISMISSIBLE_MENU_CLOSE_EVENT, onCloseAll);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const gap = 5;
    const top = anchor.bottom + gap + menu.height <= window.innerHeight
      ? anchor.bottom + gap
      : Math.max(8, anchor.top - gap - menu.height);
    const preferredLeft = align === "right" ? anchor.right - menu.width : anchor.left;
    const left = Math.max(8, Math.min(preferredLeft, window.innerWidth - menu.width - 8));
    setPosition({ top, left });
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }));
  }, [open]);

  function toggle() {
    if (disabled) return;
    if (open) { close(); return; }
    window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: idRef.current }));
    setOpen(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >{trigger}</button>
      {open && createPortal(
        <div
          ref={menuRef}
          className={`dropdown-menu dismissible-menu ${menuClassName}`}
          role="menu"
          style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? "visible" : "hidden" }}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("button")) queueMicrotask(close);
          }}
        >{children}</div>,
        document.body,
      )}
    </>
  );
}
