"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

type Props = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
};

const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;
const MENU_WIDTH = 192;

export function WorkoutCardMenu({ open, anchorRef, onClose, children }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    zIndex: 50,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;

    function positionMenu() {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;

      const rect = anchor.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const menuHeight = menuRect.height || 240;

      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING;
      const spaceAbove = rect.top - VIEWPORT_PADDING;
      const openUp = spaceBelow < menuHeight + MENU_GAP && spaceAbove >= menuHeight + MENU_GAP;

      let top = openUp ? rect.top - menuHeight - MENU_GAP : rect.bottom + MENU_GAP;
      let left = rect.right - MENU_WIDTH;

      left = Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING));
      top = Math.max(VIEWPORT_PADDING, Math.min(top, window.innerHeight - menuHeight - VIEWPORT_PADDING));

      setStyle({
        position: "fixed",
        top,
        left,
        zIndex: 50,
        visibility: "visible",
      });
    }

    frame = window.requestAnimationFrame(positionMenu);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, anchorRef, children, onClose]);

  useEffect(() => {
    if (!open) {
      setStyle({
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 50,
        visibility: "hidden",
      });
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      style={style}
      data-workout-card-menu="true"
      className="w-48 max-h-[min(70vh,20rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 text-sm shadow-xl"
    >
      {children}
    </div>,
    document.body
  );
}
