"use client";

import { useEffect, useRef, useState } from "react";
import { MousePointer2, X } from "lucide-react";
import type { AttentionCue } from "./attention";
import { useWorkspace } from "../workspace/store";
import styles from "./AttentionOverlay.module.css";

export type AttentionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
type Props = {
  cue: AttentionCue | undefined;
  active: boolean;
  measure: () => AttentionRect[];
  reveal: () => void;
  subscribe?: (update: () => void) => () => void;
};

/** Visual-only overlay. Geometry is supplied by each editor in viewport pixels. */
export default function AttentionOverlay({
  cue,
  active,
  measure,
  reveal,
  subscribe,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    rects: AttentionRect[];
    width: number;
    height: number;
  }>({ rects: [], width: 0, height: 0 });
  useEffect(() => {
    if (!cue || !active) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = root.current?.getBoundingClientRect();
        if (!bounds?.width || !bounds.height) return;
        const rects = measure()
          .filter(
            (r) =>
              r.right >= bounds.left &&
              r.left <= bounds.right &&
              r.bottom >= bounds.top &&
              r.top <= bounds.bottom,
          )
          .slice(0, 200)
          .map((r) => ({
            left: Math.max(0, r.left - bounds.left),
            top: Math.max(0, r.top - bounds.top),
            right: Math.min(bounds.width, r.right - bounds.left),
            bottom: Math.min(bounds.height, r.bottom - bounds.top),
          }));
        setLayout({ rects, width: bounds.width, height: bounds.height });
      });
    };
    // Scrolling into view never moves the student's caret or selection.
    reveal();
    update();
    const unsubscribe = subscribe?.(update);
    const observer = new ResizeObserver(update);
    if (root.current?.parentElement)
      observer.observe(root.current.parentElement);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe?.();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [cue, active, measure, reveal, subscribe]);

  if (!cue || !active) return null;
  const first = layout.rects[0];
  return (
    <div
      ref={root}
      className={styles.overlay}
      data-attention-target={cue.target}
      data-attention-mode={cue.mode}
    >
      {cue.mode === "highlight" &&
        layout.rects.map((rect, index) => (
          <div
            key={index}
            className={styles.box}
            data-attention-box
            aria-hidden="true"
            style={{
              left: rect.left,
              top: rect.top,
              width: Math.max(3, rect.right - rect.left),
              height: Math.max(3, rect.bottom - rect.top),
            }}
          />
        ))}
      {first && (
        <div
          className={styles.pointer}
          aria-hidden="true"
          style={{ left: first.left, top: first.top }}
        >
          <MousePointer2 size={24} fill="currentColor" />
        </div>
      )}
      {first && (
        <div
          className={styles.label}
          style={{
            left: Math.max(6, Math.min(first.left + 19, layout.width - 238)),
            top: Math.max(6, Math.min(first.top - 32, layout.height - 42)),
          }}
        >
          <span role="status">{cue.label}</span>
          <button
            type="button"
            aria-label={`Dismiss ${cue.target} cue`}
            onClick={() => useWorkspace.getState().clearAttention(cue.target)}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
