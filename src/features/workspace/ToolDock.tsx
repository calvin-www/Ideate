"use client";
import { useId, useRef, useState, type DragEvent } from "react";
import {
  Code,
  Ellipsis,
  LayoutGrid,
  Minimize2,
  NotebookPen,
  PanelsTopLeft,
  Presentation,
  RotateCcw,
  Table2,
  Terminal,
} from "lucide-react";
import {
  tools,
  panelTitles,
  panelTool,
  type EditorPanel,
} from "./layoutPersistence";
import { beginToolDrag, draggedTool, endToolDrag, isToolDrag } from "./toolDrag";
import styles from "./WorkspaceLayout.module.css";

const icons: Record<EditorPanel, typeof Code> = {
  board: Presentation,
  code: Code,
  notes: NotebookPen,
  spreadsheet: Table2,
  output: Terminal,
};

export type ToolDockProps = {
  focused: EditorPanel;
  visible: EditorPanel[];
  opened: EditorPanel[];
  advanced: boolean;
  narrow: boolean;
  maximized: boolean;
  hasSaved: boolean;
  activate: (tool: EditorPanel) => void;
  float: (tool: EditorPanel) => void;
  dragChange: (tool: EditorPanel | null) => void;
  single: () => void;
  restoreSaved: () => void;
  reset: () => void;
  restore: () => void;
};

function chipHint(props: ToolDockProps, tool: EditorPanel) {
  const title = panelTitles[tool];
  if (tool === props.focused) return `${title}, focused.`;
  if (props.visible.includes(tool)) return `${title}, visible. Click to focus.`;
  if (props.narrow) return `${title}, hidden. Click to switch.`;
  if (props.opened.includes(tool))
    return `${title}, behind a tab. Click to show.`;
  return `${title}, hidden. Click to add as a tab, drag to place.`;
}

export default function ToolDock(props: ToolDockProps) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 16 });
  const [dropping, setDropping] = useState(false);
  const act = (action: () => void) => {
    menu.current?.hidePopover();
    action();
  };
  const chips: EditorPanel[] =
    props.opened.includes("code") || props.visible.includes("code")
      ? [...tools, "output"]
      : tools;
  const onDragOver = (event: DragEvent) => {
    if (props.narrow || !isToolDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropping(true);
  };
  return (
    <div
      className={styles.controls}
      role="toolbar"
      aria-label="Tools"
      data-dropping={dropping || undefined}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        const tool = draggedTool(event.dataTransfer);
        setDropping(false);
        if (!tool || props.narrow) return;
        event.preventDefault();
        props.float(tool);
      }}
    >
      {chips.map((tool) => {
        const Icon = icons[tool];
        const visible = props.visible.includes(tool);
        const focused = tool === props.focused;
        return (
          <button
            key={tool}
            type="button"
            className={styles.chip}
            aria-pressed={visible}
            data-focused={focused || undefined}
            data-tool={tool}
            title={chipHint(props, tool)}
            aria-label={`${panelTitles[tool]} tool`}
            draggable={!props.narrow}
            onClick={() => props.activate(tool)}
            onDragStart={(event) => {
              beginToolDrag(tool, event.dataTransfer);
              props.dragChange(tool);
            }}
            onDragEnd={() => {
              endToolDrag();
              props.dragChange(null);
            }}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{panelTitles[tool]}</span>
          </button>
        );
      })}
      {props.maximized && (
        <button type="button" className={styles.restore} onClick={props.restore}>
          <Minimize2 size={14} />
          Restore arrangement
        </button>
      )}
      <button
        type="button"
        className={styles.overflow}
        aria-label="Arrangement"
        title="Arrangement options"
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const menuWidth = Math.min(260, window.innerWidth - 24);
          setPosition({
            top: bounds.bottom + 8,
            right: Math.min(
              Math.max(12, window.innerWidth - bounds.right),
              window.innerWidth - menuWidth - 12,
            ),
          });
        }}
      >
        <Ellipsis size={15} />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="Arrangement options"
        className={styles.menu}
        style={position}
      >
        <strong>Arrangement</strong>
        {props.narrow && (
          <p>Use a wider window to split, tab, or float editors.</p>
        )}
        <div className={styles.menuActions}>
          {props.advanced && (
            <button
              type="button"
              onClick={() => act(props.single)}
              title="Hide other tools and keep this arrangement available to restore"
            >
              <PanelsTopLeft size={14} />
              Show only {panelTitles[panelTool(props.focused)]}
            </button>
          )}
          {props.hasSaved && !props.advanced && (
            <button
              type="button"
              disabled={props.narrow}
              onClick={() => act(props.restoreSaved)}
            >
              <LayoutGrid size={14} />
              Restore previous arrangement
            </button>
          )}
          <button
            type="button"
            disabled={!props.advanced && !props.hasSaved}
            onClick={() => act(props.reset)}
            title="Forget the saved arrangement and show one tool"
          >
            <RotateCcw size={14} />
            Reset arrangement
          </button>
        </div>
      </div>
    </div>
  );
}
