import type {
  DockviewApi,
  IDockviewPanel,
  SerializedDockview,
} from "dockview-react";
import {
  isEditorPanel,
  panelTitles,
  type EditorPanel,
} from "./layoutPersistence";

export type Placement =
  "left" | "right" | "above" | "below" | "within" | "float";
export type OpenEditor = {
  tool: EditorPanel;
  placement: Placement;
  reference: EditorPanel;
};
export type DockState = {
  layout: SerializedDockview;
  visible: EditorPanel[];
  opened: EditorPanel[];
  focused?: EditorPanel;
  maximized: boolean;
};

/** Controls only layout shells. Editor React trees live in WorkspaceLayout's stable hosts. */
export class EditorDock {
  private restorePoint: SerializedDockview | null = null;
  private changing = false;
  private disposed = false;
  private frame = 0;
  private subscriptions: { dispose(): void }[] = [];

  constructor(
    readonly api: DockviewApi,
    private changed: (state: DockState) => void,
  ) {
    this.subscriptions = [
      api.onDidLayoutChange(() => this.schedule()),
      api.onDidActivePanelChange(() => this.schedule()),
      api.onDidRemovePanel(() => this.schedule()),
    ];
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }
  private schedule() {
    if (this.disposed || this.changing) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.publish());
  }
  private transaction(change: () => void) {
    this.changing = true;
    try {
      change();
    } finally {
      this.changing = false;
      this.schedule();
    }
  }
  private add(
    tool: EditorPanel,
    reference?: IDockviewPanel,
    direction: Exclude<Placement, "float"> = "right",
  ) {
    return this.api.addPanel({
      id: tool,
      component: "editor",
      title: panelTitles[tool],
      renderer: "always",
      minimumWidth: 280,
      minimumHeight: tool === "output" ? 140 : 220,
      ...(reference
        ? { position: { referencePanel: reference, direction } }
        : {}),
    });
  }
  initialize(
    layout: SerializedDockview | null,
    tool: EditorPanel,
    start?: OpenEditor,
  ) {
    this.transaction(() => {
      let restored = false;
      if (layout) {
        try {
          this.api.fromJSON(layout);
          restored = this.api.panels.length > 0;
        } catch {
          this.api.clear();
        }
      }
      if (!this.api.panels.length) this.add(tool);
      if (start) this.open(start);
      else if (!restored) this.focus(tool);
    });
  }
  capture(): SerializedDockview {
    return this.restorePoint ?? this.api.toJSON();
  }
  get maximized() {
    return this.restorePoint !== null;
  }
  private publish() {
    if (this.disposed || this.changing) return;
    const panels = this.api.panels;
    const focused = this.api.activePanel?.id;
    this.changed({
      layout: this.capture(),
      visible: panels
        .filter((panel) => panel.api.isVisible)
        .map((panel) => panel.id)
        .filter(isEditorPanel),
      opened: Object.keys(this.capture().panels).filter(isEditorPanel),
      focused: isEditorPanel(focused) ? focused : undefined,
      maximized: this.maximized,
    });
    window.dispatchEvent(new Event("ideate:editor-layout"));
  }
  focus(tool: EditorPanel) {
    if (this.maximized && !this.api.getPanel(tool)) this.restore();
    const panel =
      this.api.getPanel(tool) ?? this.add(tool, this.api.activePanel);
    if (!panel.api.isActive) panel.api.setActive();
    this.schedule();
  }
  open({ tool, placement, reference }: OpenEditor) {
    this.transaction(() => {
      if (this.restorePoint) this.restore();
      const anchor =
        this.api.getPanel(reference) ??
        (tool === "output" && reference === "code" && placement !== "float"
          ? this.add("code", this.api.activePanel)
          : this.api.activePanel);
      let panel = this.api.getPanel(tool);
      if (!panel)
        panel = this.add(
          tool,
          anchor,
          placement === "float" ? "right" : placement,
        );
      else if (anchor && anchor.id !== tool && placement !== "float")
        panel.api.moveTo({
          group: anchor.group,
          position:
            placement === "below"
              ? "bottom"
              : placement === "above"
                ? "top"
                : placement === "within"
                  ? "center"
                  : placement,
        });
      if (placement === "float") this.floatPanel(panel);
      panel.api.setActive();
    });
  }
  private floatPanel(panel: IDockviewPanel) {
    const width = Math.min(560, this.api.width - 32);
    const height = Math.min(470, this.api.height - 32);
    this.api.addFloatingGroup(panel, {
      width,
      height,
      x: Math.max(16, this.api.width - width - 28),
      y: 28,
    });
  }
  float(tool: EditorPanel) {
    this.transaction(() => {
      if (this.restorePoint) this.restore();
      const panel = this.api.getPanel(tool);
      if (panel) this.floatPanel(panel);
    });
  }
  dock(tool: EditorPanel) {
    this.transaction(() => {
      const panel = this.api.getPanel(tool);
      if (panel) {
        const target = this.api.groups.find(
          (group) =>
            group.api.location.type === "grid" && group.id !== panel.group.id,
        );
        if (target) panel.api.moveTo({ group: target, position: "right" });
        else panel.group.api.moveTo({ position: "right" });
      }
    });
  }
  maximize(tool: EditorPanel) {
    if (this.restorePoint) return;
    this.transaction(() => {
      this.restorePoint = this.api.toJSON();
      this.api.clear();
      this.add(tool);
    });
  }
  restore() {
    if (!this.restorePoint) return;
    const previous = this.restorePoint;
    this.restorePoint = null;
    this.transaction(() => this.api.fromJSON(previous));
  }
  hide(tool: EditorPanel) {
    this.transaction(() => {
      if (this.restorePoint) this.restore();
      this.api.getPanel(tool)?.api.close();
      if (tool === "output") this.focus("code");
    });
  }
}
