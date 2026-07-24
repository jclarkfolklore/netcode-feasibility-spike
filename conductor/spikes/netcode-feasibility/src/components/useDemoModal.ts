import { useCallback, useEffect, useState } from "react";

/**
 * Expand/collapse state for a live-demo stage (W2). The canvases stay mounted
 * either way — only a wrapper class changes — so Phaser never loses the canvas.
 * After a toggle we dispatch a window `resize` so Phaser's Scale.FIT refits the
 * canvas to its new (modal vs inline) frame size. `Esc` collapses.
 */
export function useDemoModal(): {
  expanded: boolean;
  toggle: () => void;
  collapse: () => void;
} {
  const [expanded, setExpanded] = useState(false);

  const refit = useCallback(() => {
    // Next frame, after layout settles, nudge Phaser to refit both games.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, []);

  const toggle = useCallback(() => {
    setExpanded((e) => !e);
    refit();
  }, [refit]);

  const collapse = useCallback(() => {
    setExpanded(false);
    refit();
  }, [refit]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, collapse]);

  return { expanded, toggle, collapse };
}
