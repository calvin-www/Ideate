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
  panelIds,
  isEditorPanel,
  panelTool,
  type EditorPanel,
  readPreviousArrangement,
  savePreviousArrangement,
  clearPreviousArrangement,
  type LayoutPreference,
} from "./layoutPersistence";
import {
  type DockState,
  type EditorDock,
  type OpenEditor,
  type Placement,
} from "./editorDock";
import DockedEditors from "./DockedEditors";
import ToolDock from "./ToolDock";
import DropOverlay from "./DropOverlay";
import { dropCommand, type DropPosition } from "./toolDrag";
import { OutputLayoutContext } from "./OutputLayoutContext";
import styles from "./WorkspaceLayout.module.css";

const labels: Record<EditorPanel, string> = {
  board: "Whiteboard tool",
  code: "Python tool",
  notes: "Notebook tool",
  spreadsheet: "Spreadsheet tool",
  output: "Output tool",
};
type Props = {
  toolbar: HTMLElement | null;
  renderEditor: (tool: Tool, visible: boolean) => ReactNode;
};

export default function WorkspaceLayout({ toolbar, renderEditor }: Props) {
  const view = useWorkspace((s) => s.view);
  const page = useWorkspace((s) => s.page);
  const visited = useWorkspace((s) => s.visited);
  const navigationEpoch = useWorkspace((s) => s.navigationEpoch);
  const navigationReveal = useWorkspace((s) => s.navigationReveal);
  const [preference] = useState(readPreviousArrangement);
  const saved = useRef<LayoutPreference | null>(preference);
  // Desk objects launch a single tool. Arrangements are restored only on request.
  const [enabled, setEnabled] = useState(false);
  const handledNavigation = useRef(navigationEpoch);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 800px)").matches,
  );
  const [dockState, setDockState] = useState<DockState | null>(null);
  const [start, setStart] = useState<OpenEditor | undefined>();
  const [dragging, setDragging] = useState<EditorPanel | null>(null);
  // Bumped when the saved arrangement ref changes outside a dock update.
  const [, setSavedVersion] = useState(0);
  const initialLayout = useRef(saved.current?.layout ?? null);
  const initialFocus = useRef(navigationReveal);
  const controller = useRef<EditorDock | null>(null);
  const parking = useRef<HTMLDivElement>(null);
  const single = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hosts] = useState(
    () =>
      Object.fromEntries(
        panelIds.map((tool) => {
          const element = document.createElement("section");
          element.className = styles.host;
          if (isTool(tool)) element.dataset.editorTool = tool;
          element.dataset.editorPanel = tool;
          element.setAttribute("aria-label", labels[tool]);
          return [tool, element];
        }),
      ) as Record<EditorPanel, HTMLElement>,
  );
  const advanced = enabled && !narrow && visited.length > 0;
  const focused: Tool = isTool(view) ? view : "board";
  const focusedPanel = advanced ? (dockState?.focused ?? focused) : focused;
  const outputDetached =
    advanced && Boolean(dockState?.opened.includes("output"));
  const visible = useMemo<EditorPanel[]>(
    () =>
      view === "desk" ? [] : advanced ? (dockState?.visible ?? []) : [focused],
    [view, advanced, dockState?.visible, focused],
  );
  const park = useCallback((host: HTMLElement) => {
    parking.current?.append(host);
  }, []);

  const persist = useCallback(() => {
    clearTimeout(timer.current);
    if (saved.current && !savePreviousArrangement(saved.current))
      useWorkspace.setState({
        notice:
          "Layout changed for this session. Browser storage is unavailable.",
      });
  }, []);
  const capture = useCallback(() => {
    if (enabledRef.current && controller.current?.api.panels.length) {
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
    const outputVisible = outputDetached
      ? visible.includes("output")
      : visible.includes("code");
    hosts.output.hidden = !outputVisible;
    hosts.output.inert = !outputVisible;
    const state = useWorkspace.getState();
    const visibleTools = visible.filter(isTool);
    if (state.visibleTools.join() !== visibleTools.join())
      useWorkspace.setState({ visibleTools });
  }, [advanced, view, visible, hosts, outputDetached]);

  useLayoutEffect(() => {
    if (handledNavigation.current === navigationEpoch) return;
    handledNavigation.current = navigationEpoch;
    if (navigationReveal) {
      // References reveal a pane in the current arrangement, including from the desk.
      if (advanced) controller.current?.focus(navigationReveal);
      else if (enabledRef.current) initialFocus.current = navigationReveal;
      return;
    }
    capture();
    persist();
    if (page === "desk") return;
    initialLayout.current = null;
    initialFocus.current = null;
    enabledRef.current = false;
    if (saved.current) saved.current = { ...saved.current, enabled: false };
    setEnabled(false);
    setDockState(null);
    setStart(undefined);
    persist();
  }, [
    navigationEpoch,
    navigationReveal,
    page,
    advanced,
    capture,
    persist,
  ]);

  const changed = useCallback(
    (state: DockState) => {
      initialFocus.current = null;
      setDockState(state);
      const workspace = useWorkspace.getState();
      const visited = Array.from(
        new Set([...workspace.visited, ...state.opened.map(panelTool)]),
      );
      if (visited.length !== workspace.visited.length)
        useWorkspace.setState({ visited });
      if (workspace.view !== "desk" && state.focused)
        workspace.focusTool(panelTool(state.focused));
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

  function open(tool: EditorPanel, placement: Placement) {
    const command = {
      tool,
      placement,
      reference: tool === "output" ? ("code" as const) : focusedPanel,
    };
    if (advanced) controller.current?.open(command);
    else {
      initialLayout.current = null;
      setStart(command);
      setDockState(null);
      setEnabled(true);
    }
  }
  function activate(tool: EditorPanel) {
    const workspace = useWorkspace.getState();
    if (narrow) {
      if (tool !== focusedPanel) workspace.navigate(panelTool(tool));
      return;
    }
    if (tool === focusedPanel) return;
    if (advanced && dockState?.opened.includes(tool)) {
      controller.current?.focus(tool);
      return;
    }
    open(tool, "within");
  }
  function drop(
    tool: EditorPanel,
    position: DropPosition,
    reference: EditorPanel | undefined,
  ) {
    const command = dropCommand({
      tool,
      position,
      reference,
      fallback: focusedPanel,
    });
    if (advanced) controller.current?.open(command);
    else {
      initialLayout.current = null;
      setStart(command);
      setDockState(null);
      setEnabled(true);
    }
  }
  function reset() {
    singleEditor();
    saved.current = null;
    setSavedVersion((version) => version + 1);
    if (!clearPreviousArrangement())
      useWorkspace.setState({
        notice:
          "Arrangement reset for this session. Browser storage is unavailable.",
      });
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey)
        return;
      const index = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(
        event.code,
      );
      if (index < 0 || useWorkspace.getState().view === "desk") return;
      event.preventDefault();
      activate(tools[index]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function singleEditor() {
    capture();
    if (saved.current) saved.current = { ...saved.current, enabled: false };
    enabledRef.current = false;
    setEnabled(false);
    setDockState(null);
    setStart(undefined);
    useWorkspace.getState().focusTool(panelTool(focusedPanel));
    persist();
  }
  function restoreSaved() {
    if (!saved.current) return;
    initialLayout.current = saved.current?.layout ?? null;
    initialFocus.current = null;
    setStart(undefined);
    setDockState(null);
    setEnabled(true);
  }
  function focusTarget(target: EventTarget | null) {
    const panel = (target as HTMLElement)?.closest<HTMLElement>(
      "[data-editor-panel]",
    )?.dataset.editorPanel;
    if (isEditorPanel(panel)) {
      useWorkspace.getState().focusTool(panelTool(panel));
      if (advanced)
        controller.current?.focus(
          panel === "output" && !outputDetached ? "code" : panel,
        );
    }
  }
  return (
    <OutputLayoutContext.Provider
      value={{
        host: hosts.output,
        detached: outputDetached,
        narrow,
        move: (placement) => open("output", placement),
        attach: () => controller.current?.hide("output"),
        showSource: () => controller.current?.focus("code"),
      }}
    >
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
        {!advanced && dragging && !narrow && (
          <DropOverlay
            onDrop={(tool, placement) => {
              setDragging(null);
              open(tool, placement);
            }}
          />
        )}
        {advanced && (
          <DockedEditors
            hosts={hosts}
            park={park}
            initialLayout={initialLayout.current}
            initialTool={focused}
            initialFocus={initialFocus.current}
            start={start}
            onChange={changed}
            onController={(instance) => {
              controller.current = instance;
            }}
            onDrop={drop}
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
            <ToolDock
              focused={focusedPanel}
              visible={visible}
              opened={advanced ? (dockState?.opened ?? []) : [focused]}
              advanced={advanced}
              narrow={narrow}
              maximized={Boolean(advanced && dockState?.maximized)}
              hasSaved={Boolean(saved.current)}
              activate={activate}
              float={(tool) => open(tool, "float")}
              dragChange={setDragging}
              single={singleEditor}
              restoreSaved={restoreSaved}
              reset={reset}
              restore={() => controller.current?.restore()}
            />,
            toolbar,
          )}
      </div>
    </OutputLayoutContext.Provider>
  );
}
