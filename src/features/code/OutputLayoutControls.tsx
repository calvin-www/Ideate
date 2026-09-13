"use client";

import { useId, useRef, useState } from "react";
import { Move, PictureInPicture2, Undo2 } from "lucide-react";
import { useOutputLayout } from "../workspace/OutputLayoutContext";
import type { Placement } from "../workspace/editorDock";
import styles from "./CodePanel.module.css";

const positions: { label: string; placement: Placement }[] = [
  { label: "Move output left", placement: "left" },
  { label: "Move output right", placement: "right" },
  { label: "Move output above", placement: "above" },
  { label: "Move output below", placement: "below" },
  { label: "Tab with editor", placement: "within" },
  { label: "Float output", placement: "float" },
];

export default function OutputLayoutControls() {
  const layout = useOutputLayout();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 16 });
  if (!layout) return null;
  function act(action: () => void) {
    menu.current?.hidePopover();
    action();
  }
  return (
    <>
      <button
        type="button"
        className={styles.clearButton}
        aria-label="Move output"
        title="Move output"
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const menuHeight = 295;
          setPosition({
            top: Math.max(
              12,
              Math.min(bounds.bottom + 6, window.innerHeight - menuHeight - 12),
            ),
            right: Math.max(12, window.innerWidth - bounds.right),
          });
        }}
      >
        <Move size={14} aria-hidden="true" />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="Output position"
        className={styles.outputMenu}
        style={position}
      >
        <strong>Move output</strong>
        {layout.narrow && <p>Use a wider window to rearrange output.</p>}
        {positions.map(({ label, placement }) => (
          <button
            key={placement}
            type="button"
            disabled={layout.narrow}
            onClick={() => act(() => layout.move(placement))}
          >
            {placement === "float" ? (
              <PictureInPicture2 size={14} />
            ) : (
              <Move size={14} />
            )}
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={!layout.detached}
          onClick={() => act(layout.attach)}
        >
          <Undo2 size={14} />
          Return output to editor
        </button>
      </div>
    </>
  );
}
