"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Distance from the viewport edge at which a drag starts scrolling the page. */
const EDGE_PX = 72;
const EDGE_SCROLL_STEP = 14;

export type DropMarker = "before" | "after" | null;

/**
 * Drag-to-reorder for a vertical list, on Pointer Events — so the same handle
 * works with a mouse, a finger and a pen. Native HTML5 drag-and-drop never
 * fires on touch screens, which is why the older lists fall back to ↑/↓ there.
 *
 * Rows register with `rowRef(id)`; the grip spreads `handleProps(id)`. On drop
 * `onMove(id, toIndex)` gets the index in the list WITHOUT the dragged row —
 * exactly what moveToIndex() expects.
 */
export function useSortableList({
  ids,
  onMove,
}: {
  ids: readonly string[];
  onMove: (id: string, toIndex: number) => void;
}) {
  const rows = useRef(new Map<string, HTMLElement>());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropRef = useRef<number | null>(null);

  const targetIndex = useCallback(
    (id: string, clientY: number) => {
      let index = 0;
      for (const other of ids) {
        if (other === id) continue;
        const r = rows.current.get(other)?.getBoundingClientRect();
        if (r && clientY > r.top + r.height / 2) index++;
      }
      return index;
    },
    [ids],
  );

  const handleProps = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      setDragId(id);
      const start = targetIndex(id, e.clientY);
      dropRef.current = start;
      setDropIndex(start);

      const move = (ev: PointerEvent) => {
        if (ev.clientY < EDGE_PX) window.scrollBy(0, -EDGE_SCROLL_STEP);
        else if (ev.clientY > window.innerHeight - EDGE_PX) window.scrollBy(0, EDGE_SCROLL_STEP);
        const next = targetIndex(id, ev.clientY);
        if (next !== dropRef.current) {
          dropRef.current = next;
          setDropIndex(next);
        }
      };
      const end = (ev: PointerEvent) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        const to = dropRef.current;
        dropRef.current = null;
        setDragId(null);
        setDropIndex(null);
        if (ev.type === "pointerup" && to !== null) onMove(id, to);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    },
    // Stop the page from scrolling under a finger that is dragging the grip.
    style: { touchAction: "none" as const },
  });

  const rowRef = (id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };

  /** Where the drop line sits relative to `id`'s row while dragging. */
  const dropMarker = (id: string): DropMarker => {
    if (dragId === null || dropIndex === null || id === dragId) return null;
    const rest = ids.filter((x) => x !== dragId);
    if (rest[dropIndex] === id) return "before";
    if (dropIndex === rest.length && rest[rest.length - 1] === id) return "after";
    return null;
  };

  return { dragId, handleProps, rowRef, dropMarker };
}
