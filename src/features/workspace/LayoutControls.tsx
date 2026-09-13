"use client";
import { useId, useRef, useState } from "react";
import {
  Columns2,
  Rows2,
  PanelsTopLeft,
  PictureInPicture2,
  LayoutGrid,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  tools,
  panelTitles as toolTitles,
  panelTool,
  type EditorPanel,
} from "./layoutPersistence";
import type { Tool } from "./model";
import type { Placement } from "./editorDock";
import styles from "./WorkspaceLayout.module.css";

type Props = {
  focused: EditorPanel;
  advanced: boolean;
  maximized: boolean;
  narrow: boolean;
  hasSaved: boolean;
  open: (tool: Tool, placement: Placement) => void;
  single: () => void;
  restoreSaved: () => void;
  maximize: () => void;
  restore: () => void;
  resize: (axis: "width" | "height", delta: number) => void;
};
export default function LayoutControls(props: Props) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 16 });
  const [more, setMore] = useState(false);
  const act = (action: () => void) => {
    menu.current?.hidePopover();
    setMore(false);
    action();
  };
  return (
    <div className={styles.controls}>
      {props.maximized && (
        <button
          type="button"
          className={styles.restore}
          onClick={props.restore}
        >
          <Minimize2 size={14} />
          Restore arrangement
        </button>
      )}
      <button
        type="button"
        className={styles.layoutButton}
        aria-label="Editor layout"
        title="Arrange editors"
        popoverTarget={id}
        onClick={(event) => {
          setMore(false);
          const bounds = event.currentTarget.getBoundingClientRect();
          const menuWidth = Math.min(315, window.innerWidth - 24);
          setPosition({
            top: bounds.bottom + 8,
            right: Math.min(
              Math.max(12, window.innerWidth - bounds.right),
              window.innerWidth - menuWidth - 12,
            ),
          });
        }}
      >
        <LayoutGrid size={15} />
        <span>Layout</span>
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="Editor layout options"
        className={styles.menu}
        style={position}
      >
        <strong>Arrange editors</strong>
        <p>
          {props.narrow
            ? "Use a wider window to split or float editors."
            : `Arrange tools beside or below ${toolTitles[props.focused]}.`}
        </p>
        <div className={styles.columnLabels} aria-hidden="true">
          <span>Tool</span>
          <span>Beside</span>
          <span>Below</span>
        </div>
        {tools
          .filter((tool) => tool !== props.focused)
          .map((tool) => (
            <div key={tool} className={styles.toolRow}>
              <span>{toolTitles[tool]}</span>
              <button
                type="button"
                disabled={props.narrow}
                aria-label={`Split with ${toolTitles[tool]}`}
                title="Split side by side"
                onClick={() => act(() => props.open(tool, "right"))}
              >
                <Columns2 size={16} />
              </button>
              <button
                type="button"
                disabled={props.narrow}
                aria-label={`Stack with ${toolTitles[tool]}`}
                title="Split above and below"
                onClick={() => act(() => props.open(tool, "below"))}
              >
                <Rows2 size={16} />
              </button>
            </div>
          ))}
        {!props.narrow && (
          <>
            <button
              type="button"
              className={styles.moreButton}
              aria-expanded={more}
              aria-controls={`${id}-more`}
              onClick={() => setMore(!more)}
            >
              More arrangements <span aria-hidden="true">{more ? "−" : "+"}</span>
            </button>
            <div id={`${id}-more`} hidden={!more}>
              <div className={styles.columnLabels} aria-hidden="true">
                <span>Tool</span>
                <span>Tab</span>
                <span>Float</span>
              </div>
              {tools.filter((tool) => tool !== props.focused).map((tool) => (
                <div key={tool} className={styles.toolRow}>
                  <span>{toolTitles[tool]}</span>
                  <button
                    type="button"
                    aria-label={`Tab with ${toolTitles[tool]}`}
                    title="Add to tab group"
                    onClick={() => act(() => props.open(tool, "within"))}
                  >
                    <PanelsTopLeft size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Float ${toolTitles[tool]}`}
                    title="Open floating editor"
                    onClick={() => act(() => props.open(tool, "float"))}
                  >
                    <PictureInPicture2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className={styles.menuActions} hidden={!props.advanced && !props.hasSaved}>
          {props.advanced && !props.maximized && (
            <button type="button" onClick={() => act(props.maximize)}>
              <Maximize2 size={14} />
              Maximize {toolTitles[props.focused]}
            </button>
          )}
          {props.maximized && (
            <button type="button" onClick={() => act(props.restore)}>
              <Minimize2 size={14} />
              Restore arrangement
            </button>
          )}
          {props.advanced && (
            <button
              type="button"
              onClick={() => act(props.single)}
              title="Hide other tools and keep this arrangement available to restore"
            >
              <PanelsTopLeft size={14} />
              Show only {toolTitles[panelTool(props.focused)]}
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
        </div>
        {props.advanced && !props.maximized && (
          <div className={styles.keyboardSizing}>
            <span>Resize {toolTitles[props.focused]}</span>
            <div>
              <button
                type="button"
                aria-label="Make editor narrower"
                onClick={() => props.resize("width", -40)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Make editor wider"
                onClick={() => props.resize("width", 40)}
              >
                →
              </button>
              <button
                type="button"
                aria-label="Make editor shorter"
                onClick={() => props.resize("height", -40)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Make editor taller"
                onClick={() => props.resize("height", 40)}
              >
                ↓
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
