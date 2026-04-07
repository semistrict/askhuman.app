"use client";

import { useCallback, useRef, useEffect, useState } from "react";

export function usePersistedWidth(
  key: string,
  defaultWidth: number
): [number, (updater: number | ((prev: number) => number)) => void] {
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 50) {
        setWidth(parsed);
      }
    }
  }, [key]);

  const setAndPersist = useCallback(
    (updater: number | ((prev: number) => number)) => {
      setWidth((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        localStorage.setItem(key, String(next));
        return next;
      });
    },
    [key]
  );

  return [width, setAndPersist];
}

export function ResizeHandle({
  side,
  onDrag,
  minWidth = 100,
}: {
  side: "left" | "right";
  onDrag: (setter: (prev: number) => number) => void;
  minWidth?: number;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        const signedDelta = side === "left" ? delta : -delta;
        onDragRef.current((prev) => Math.max(minWidth, prev + signedDelta));
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [side, minWidth]
  );

  return (
    <div
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      onMouseDown={onMouseDown}
    />
  );
}
