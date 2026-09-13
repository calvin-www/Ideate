"use client";

import { createContext, useContext, useLayoutEffect, useRef } from "react";
import {
  DockviewReact,
  type IDockviewPanelProps,
  type IDockviewHeaderActionsProps,
  themeLight,
} from "dockview-react";
import type { SerializedDockview } from "dockview-react";
import {
  Maximize2,
  PanelsTopLeft,
  PictureInPicture2,
  Undo2,
  X,
} from "lucide-react";
import { EditorDock, type DockState, type OpenEditor } from "./editorDock";
import {
  isEditorPanel,
  panelTitles,
  type EditorPanel,
} from "./layoutPersistence";
import type { Tool } from "./model";
import styles from "./WorkspaceLayout.module.css";
import "dockview-react/dist/styles/dockview.css";

type Hosts = Record<EditorPanel, HTMLElement>;
type Context = {
  hosts: Hosts;
  park: (host: HTMLElement) => void;
  controller: () => EditorDock | null;
};
const DockContext = createContext<Context | null>(null);

function EditorMount({ api }: IDockviewPanelProps) {
  const mount = useRef<HTMLDivElement>(null);
  const context = useContext(DockContext)!;
  useLayoutEffect(() => {
    if (!isEditorPanel(api.id) || !mount.current) return;
    const host = context.hosts[api.id];
    const parent = mount.current;
    parent.append(host);
    return () => {
      if (host.parentElement === parent) context.park(host);
    };
  }, [api.id, context]);
  return <div ref={mount} className={styles.mount} />;
}
const components = { editor: EditorMount };

function HeaderActions({
  activePanel,
  location,
  containerApi,
}: IDockviewHeaderActionsProps) {
  const context = useContext(DockContext)!;
  if (!activePanel || !isEditorPanel(activePanel.id)) return null;
  const tool = activePanel.id;
  const title = panelTitles[tool];
  const floating = location?.type === "floating";
  return (
    <div className={styles.groupActions}>
      {!context.controller()?.maximized && (
        <>
          <button
            type="button"
            aria-label={`${floating ? "Dock" : "Float"} ${title}`}
            title={`${floating ? "Dock" : "Float"} ${title}`}
            disabled={!floating && containerApi.panels.length < 2}
            onClick={() =>
              floating
                ? context.controller()?.dock(tool)
                : context.controller()?.float(tool)
            }
          >
            {floating ? (
              <PanelsTopLeft size={14} />
            ) : (
              <PictureInPicture2 size={14} />
            )}
          </button>
          <button
            type="button"
            aria-label={`Maximize ${title}`}
            title={`Maximize ${title}`}
            onClick={() => context.controller()?.maximize(tool)}
          >
            <Maximize2 size={14} />
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={
          tool === "output" ? "Return output to editor" : `Hide ${title}`
        }
        title={tool === "output" ? "Return output to editor" : `Hide ${title}`}
        onClick={() => context.controller()?.hide(tool)}
      >
        {tool === "output" ? <Undo2 size={14} /> : <X size={14} />}
      </button>
    </div>
  );
}

type Props = {
  hosts: Hosts;
  park: (host: HTMLElement) => void;
  initialLayout: SerializedDockview | null;
  initialTool: Tool;
  initialFocus: Tool | null;
  start?: OpenEditor;
  onChange: (state: DockState) => void;
  onController: (controller: EditorDock | null) => void;
};
export default function DockedEditors(props: Props) {
  const current = useRef(props);
  current.current = props;
  const controller = useRef<EditorDock | null>(null);
  const context = useRef<Context>({
    hosts: props.hosts,
    park: props.park,
    controller: () => controller.current,
  });
  useLayoutEffect(
    () => () => {
      controller.current?.dispose();
      controller.current = null;
      current.current.onController(null);
    },
    [],
  );
  return (
    <DockContext.Provider value={context.current}>
      <DockviewReact
        className={styles.dock}
        theme={themeLight}
        components={components}
        rightHeaderActionsComponent={HeaderActions}
        floatingGroupBounds="boundedWithinViewport"
        floatingGroupDragHandle="titlebar"
        defaultRenderer="always"
        onReady={({ api }) => {
          const instance = new EditorDock(api, (state) =>
            current.current.onChange(state),
          );
          controller.current = instance;
          current.current.onController(instance);
          instance.initialize(
            current.current.initialLayout,
            current.current.initialTool,
            current.current.start,
          );
          if (current.current.initialFocus)
            instance.focus(current.current.initialFocus);
        }}
      />
    </DockContext.Provider>
  );
}
