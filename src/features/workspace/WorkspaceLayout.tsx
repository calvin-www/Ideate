"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Tool } from "./model";
import { useWorkspace } from "./store";
import {
  tools,
  isTool,
  readLayoutPreference,
  saveLayoutPreference,
  type LayoutPreference,
} from "./layoutPersistence";
import {
  type DockState,
  type EditorDock,
  type OpenEditor,
  type Placement,
} from "./editorDock";
import DockedEditors from "./DockedEditors";
import LayoutControls from "./LayoutControls";
import styles from "./WorkspaceLayout.module.css";

const labels: Record<Tool, string> = {
  board: "Whiteboard tool",
  code: "Python tool",
  notes: "Notebook tool",
};
type Props = {
  toolbar: HTMLElement | null;
  renderEditor: (tool: Tool, visible: boolean) => ReactNode;
};

export default function WorkspaceLayout({ toolbar, renderEditor }: Props) {
  const view = useWorkspace((s) => s.view);
  const visited = useWorkspace((s) => s.visited);
  const navigationEpoch = useWorkspace((s) => s.navigationEpoch);
  const [preference] = useState(readLayoutPreference);
  const saved = useRef<LayoutPreference | null>(preference);
  // Header navigation always opens the familiar single editor. Saved layouts are opt-in.
  const [enabled, setEnabled] = useState(false);
  const handledNavigation = useRef(navigationEpoch);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 800px)").matches,
  );
  const [dockState, setDockState] = useState<DockState | null>(null);
  const [start, setStart] = useState<OpenEditor | undefined>();
  const initialLayout = useRef(preference?.layout ?? null);
  const controller = useRef<EditorDock | null>(null);
  const parking = useRef<HTMLDivElement>(null);
  const single = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hosts] = useState(
    () =>
      Object.fromEntries(
        tools.map((tool) => {
          const element = document.createElement("section");
          element.className = styles.host;
          element.dataset.editorTool = tool;
          element.setAttribute("aria-label", labels[tool]);
          return [tool, element];
        }),
      ) as Record<Tool, HTMLElement>,
  );
  const advanced = enabled && !narrow && visited.length > 0;
  const focused: Tool = isTool(view) ? view : "board";
  const visible = useMemo(
    () =>
      view === "desk" ? [] : advanced ? (dockState?.visible ?? []) : [focused],
    [view, advanced, dockState?.visible, focused],
  );
  const park = useCallback((host: HTMLElement) => {
    parking.current?.append(host);
  }, []);

  const persist = useCallback(() => {
    clearTimeout(timer.current);
    if (!saveLayoutPreference(saved.current))
      useWorkspace.setState({
        notice:
          "Layout changed for this session. Browser storage is unavailable.",
      });
  }, []);
  const capture = useCallback(() => {
    if (controller.current?.api.panels.length) {
      const layout = controller.current.capture();
      if (layout.grid.width > 0 && layout.grid.height > 0)
        saved.current = { version: 1, enabled: enabledRef.current, layout };
    }
  }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 800px)");
    const change = () => {
      capture();
      initialLayout.current = saved.current?.layout ?? null;
      setStart(undefined);
      setNarrow(media.matches);
    };
    media.addEventListener("change", change);
    const save = () => {
      capture();
      persist();
    };
    window.addEventListener("pagehide", save);
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener("pagehide", save);
      clearTimeout(timer.current);
    };
  }, [capture, persist]);

  useLayoutEffect(() => {
    if (!advanced) {
      tools.forEach((tool) => {
        const destination = tool === view ? single.current : parking.current;
        if (destination && hosts[tool].parentElement !== destination)
          destination.append(hosts[tool]);
      });
    }
    for (const tool of tools) {
      hosts[tool].hidden = !visible.includes(tool);
      hosts[tool].inert = !visible.includes(tool);
    }
    const state = useWorkspace.getState();
    if (state.visibleTools.join() !== visible.join())
      useWorkspace.setState({ visibleTools: visible });
  }, [advanced, view, visible, hosts]);

  useLayoutEffect(() => {
    if (handledNavigation.current === navigationEpoch) return;
    handledNavigation.current = navigationEpoch;
    if (view === "desk" || !enabled) return;
    capture();
    if (saved.current) saved.current = { ...saved.current, enabled: false };
    setEnabled(false);
    setDockState(null);
    setStart(undefined);
    persist();
  }, [navigationEpoch, view, enabled, capture, persist]);

  const changed = useCallback(
    (state: DockState) => {
      setDockState(state);
      const workspace = useWorkspace.getState();
      const visited = Array.from(
        new Set([...workspace.visited, ...state.opened]),
      );
      if (visited.length !== workspace.visited.length)
        useWorkspace.setState({ visited });
      if (workspace.view !== "desk" && state.focused)
        workspace.focusTool(state.focused);
      if (!state.opened.length) {
        if (saved.current) saved.current = { ...saved.current, enabled: false };
        setEnabled(false);
        persist();
        return;
      }
      if (
        state.layout.grid.width > 0 &&
        state.layout.grid.height > 0 &&
        workspace.view !== "desk"
      ) {
        saved.current = { version: 1, enabled: true, layout: state.layout };
        clearTimeout(timer.current);
        timer.current = setTimeout(persist, 250);
      }
    },
    [persist],
  );

  function open(tool: Tool, placement: Placement) {
    const command = { tool, placement, reference: focused };
    if (advanced) controller.current?.open(command);
    else {
      initialLayout.current = null;
      setStart(command);
      setDockState(null);
      setEnabled(true);
    }
  }
  function singleEditor() {
    capture();
    if (saved.current) saved.current = { ...saved.current, enabled: false };
    setEnabled(false);
    setDockState(null);
    setStart(undefined);
    persist();
  }
  function reset() {
    saved.current = null;
    initialLayout.current = null;
    setStart(undefined);
    setEnabled(false);
    setDockState(null);
    persist();
  }
  function restoreSaved() {
    initialLayout.current = saved.current?.layout ?? null;
    setStart(undefined);
    setDockState(null);
    setEnabled(true);
  }
  function focusTarget(target: EventTarget | null) {
    const tool = (target as HTMLElement)?.closest<HTMLElement>(
      "[data-editor-tool]",
    )?.dataset.editorTool;
    if (isTool(tool)) {
      useWorkspace.getState().focusTool(tool);
      if (advanced) controller.current?.focus(tool);
    }
  }
  return (
    <div
      className={styles.layout}
      hidden={view === "desk"}
      onPointerDownCapture={(event) => focusTarget(event.target)}
      onFocusCapture={(event) => focusTarget(event.target)}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !document.querySelector("[popover]:popover-open") &&
          controller.current?.maximized
        ) {
          event.preventDefault();
          event.stopPropagation();
          controller.current.restore();
        }
      }}
    >
      <div ref={parking} hidden />
      <div ref={single} className={styles.single} hidden={advanced} />
      {advanced && (
        <DockedEditors
          hosts={hosts}
          park={park}
          initialLayout={initialLayout.current}
          initialTool={focused}
          start={start}
          onChange={changed}
          onController={(instance) => {
            controller.current = instance;
          }}
        />
      )}
      {visited.map((tool) =>
        createPortal(
          renderEditor(tool, visible.includes(tool)),
          hosts[tool],
          tool,
        ),
      )}
      {toolbar &&
        createPortal(
          <LayoutControls
            focused={focused}
            advanced={advanced}
            narrow={narrow}
            maximized={Boolean(advanced && dockState?.maximized)}
            hasSaved={Boolean(saved.current)}
            open={open}
            single={singleEditor}
            reset={reset}
            restoreSaved={restoreSaved}
            maximize={() => controller.current?.maximize(focused)}
            restore={() => controller.current?.restore()}
            resize={(axis, delta) =>
              controller.current?.resize(focused, axis, delta)
            }
          />,
          toolbar,
        )}
    </div>
  );
}
