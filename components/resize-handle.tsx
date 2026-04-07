"use client";

import { useCallback, useRef, useEffect, useState } from "react";

export function usePersistedWidth(key: string, defaultWidth: number): [number, (w: number) => void] {
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
    (w: number) => {
      setWidth(w);
      localStorage.setItem(key, String(w));
    },
    [key]
  );

  return [width, setAndPersist];
}

export function ResizeHandle({
  side,
  onResize,
}: {
  side: "left" | "right";
  onResize: (delta: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        // For a left-side panel, dragging right increases width
        // For a right-side panel, dragging left increases width
        onResize(side === "left" ? delta : -delta);
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
    [onResize, side]
  );

  return (
    <div
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      onMouseDown={onMouseDown}
    />
  );
}
