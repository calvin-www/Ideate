"use client";
import { useState, type DragEvent } from "react";
import type { Placement } from "./editorDock";
import type { EditorPanel } from "./layoutPersistence";
import { draggedTool, isToolDrag } from "./toolDrag";
import styles from "./WorkspaceLayout.module.css";

const regions: { placement: Placement; label: string }[] = [
  { placement: "left", label: "Place on the left" },
  { placement: "above", label: "Place above" },
  { placement: "within", label: "Add as a tab" },
  { placement: "below", label: "Place below" },
  { placement: "right", label: "Place on the right" },
];

type Props = { onDrop: (tool: EditorPanel, placement: Placement) => void };

/** Drop targets for the single-editor view, where Dockview is not mounted. */
export default function DropOverlay({ onDrop }: Props) {
  const [active, setActive] = useState<Placement | null>(null);
  const over = (placement: Placement) => (event: DragEvent) => {
    if (!isToolDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (active !== placement) setActive(placement);
  };
  return (
    <div
      className={styles.dropOverlay}
      aria-hidden="true"
      data-testid="drop-overlay"
    >
      {regions.map(({ placement, label }) => (
        <div
          key={placement}
          className={styles.dropRegion}
          data-placement={placement}
          data-active={active === placement || undefined}
          title={label}
          onDragOver={over(placement)}
          onDragLeave={() =>
            setActive((current) => (current === placement ? null : current))
          }
          onDrop={(event) => {
            const tool = draggedTool(event.dataTransfer);
            setActive(null);
            if (!tool) return;
            event.preventDefault();
            onDrop(tool, placement);
          }}
        />
      ))}
    </div>
  );
}
