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
  readPageLayouts,
  savePageLayouts,
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
import { OutputLayoutContext } from "./OutputLayoutContext";
import styles from "./WorkspaceLayout.module.css";

const labels: Record<EditorPanel, string> = {
  board: "Whiteboard tool",
  code: "Python tool",
  notes: "Notebook tool",
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
  const [preferences] = useState(readPageLayouts);
  const pages = useRef(preferences);
  const owner = useRef<Tool | null>(isTool(page) ? page : null);
  const [layoutPage, setLayoutPage] = useState(owner.current);
  const saved = useRef<LayoutPreference | null>(
    owner.current ? (preferences[owner.current] ?? null) : null,
  );
  // Each header page starts with one editor and remembers its own optional arrangement.
  const [enabled, setEnabled] = useState(saved.current?.enabled ?? false);
  const handledNavigation = useRef(navigationEpoch);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 800px)").matches,
  );
  const [dockState, setDockState] = useState<DockState | null>(null);
  const [start, setStart] = useState<OpenEditor | undefined>();
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
    if (owner.current) {
      if (saved.current) pages.current[owner.current] = saved.current;
      else delete pages.current[owner.current];
    }
    if (!savePageLayouts(pages.current))
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
    if (page !== "desk" && owner.current === page) {
      if (advanced) {
        const activePanel = controller.current?.api.activePanel?.id;
        // Header navigation preserves the active tab; Show actions explicitly reveal a tool.
        controller.current?.focus(
          navigationReveal ?? (isEditorPanel(activePanel) ? activePanel : page),
        );
      }
      return;
    }
    capture();
    persist();
    if (page === "desk") return;
    owner.current = page;
    saved.current = pages.current[page] ?? null;
    initialLayout.current = saved.current?.layout ?? null;
    initialFocus.current =
      saved.current?.enabled && !narrow ? navigationReveal : null;
    setLayoutPage(page);
    setEnabled(saved.current?.enabled ?? false);
    setDockState(null);
    setStart(undefined);
  }, [
    navigationEpoch,
    navigationReveal,
    page,
    advanced,
    narrow,
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
  function singleEditor() {
    capture();
    if (saved.current) saved.current = { ...saved.current, enabled: false };
    setEnabled(false);
    setDockState(null);
    setStart(undefined);
    if (owner.current) useWorkspace.getState().focusTool(owner.current);
    persist();
  }
  function reset() {
    saved.current = null;
    initialLayout.current = null;
    setStart(undefined);
    setEnabled(false);
    setDockState(null);
    if (owner.current) useWorkspace.getState().focusTool(owner.current);
    persist();
  }
  function restoreSaved() {
    initialLayout.current = saved.current?.layout ?? null;
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
        {advanced && (
          <DockedEditors
            key={layoutPage}
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
              focused={focusedPanel}
              advanced={advanced}
              narrow={narrow}
              maximized={Boolean(advanced && dockState?.maximized)}
              hasSaved={Boolean(saved.current)}
              open={open}
              single={singleEditor}
              reset={reset}
              restoreSaved={restoreSaved}
              maximize={() => controller.current?.maximize(focusedPanel)}
              restore={() => controller.current?.restore()}
              resize={(axis, delta) =>
                controller.current?.resize(focusedPanel, axis, delta)
              }
            />,
            toolbar,
          )}
      </div>
    </OutputLayoutContext.Provider>
  );
}
