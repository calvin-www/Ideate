import type { SerializedDockview } from "dockview-react";
import type { Tool } from "./model";

export const LAYOUT_STORAGE_KEY = "ideate:editor-layout:v1";
export const toolTitles: Record<Tool, string> = {
  board: "Whiteboard",
  code: "Python",
  notes: "Journal",
  spreadsheet: "Spreadsheet",
};
export const tools: Tool[] = ["board", "code", "notes", "spreadsheet"];
export const isTool = (id: unknown): id is Tool => tools.includes(id as Tool);
export type EditorPanel = Tool | "output";
export const panelIds: EditorPanel[] = [...tools, "output"];
export const panelTitles: Record<EditorPanel, string> = {
  ...toolTitles,
  output: "Output",
};
export const isEditorPanel = (id: unknown): id is EditorPanel =>
  panelIds.includes(id as EditorPanel);
export const panelTool = (panel: EditorPanel): Tool =>
  panel === "output" ? "code" : panel;
export type LayoutPreference = {
  version: 1;
  enabled: boolean;
  layout: SerializedDockview;
};
export const PAGE_LAYOUT_STORAGE_KEY = "ideate:page-layouts:v1";
export type PageLayouts = Partial<Record<Tool, LayoutPreference>>;

export const PREVIOUS_ARRANGEMENT_KEY = "ideate:previous-arrangement:v1";

/** Old page arrangements remain recoverable, but are never opened implicitly. */
export function readPreviousArrangement(): LayoutPreference | null {
  try {
    const raw = localStorage.getItem(PREVIOUS_ARRANGEMENT_KEY);
    if (raw !== null) return parseLayoutPreference(raw);
    return Object.values(readPageLayouts())[0] ?? null;
  } catch {
    return null;
  }
}

export function savePreviousArrangement(preference: LayoutPreference): boolean {
  try {
    localStorage.setItem(PREVIOUS_ARRANGEMENT_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

export function clearPreviousArrangement(): boolean {
  try {
    localStorage.removeItem(PREVIOUS_ARRANGEMENT_KEY);
    localStorage.removeItem(PAGE_LAYOUT_STORAGE_KEY);
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function parsePageLayouts(raw: string | null): PageLayouts {
  if (!raw || raw.length > 100000) return {};
  try {
    const value = object(JSON.parse(raw));
    if (value.version !== 1) return {};
    const pages = object(value.pages);
    const result: PageLayouts = {};
    for (const page of tools) {
      const preference = parseLayoutPreference(
        JSON.stringify(pages[page]) ?? null,
      );
      if (preference) result[page] = preference;
    }
    return result;
  } catch {
    return {};
  }
}

export function readPageLayouts(): PageLayouts {
  try {
    const raw = localStorage.getItem(PAGE_LAYOUT_STORAGE_KEY);
    if (raw !== null) return parsePageLayouts(raw);
    const legacy = readLayoutPreference();
    if (!legacy) return {};
    // Legacy layouts were global; their first editor is the closest available owner.
    const owner = Object.keys(legacy.layout.panels).find(isTool) ?? "code";
    return { [owner]: legacy };
  } catch {
    return {};
  }
}

export function savePageLayouts(pages: PageLayouts): boolean {
  try {
    // An empty map intentionally prevents a reset layout from being migrated again.
    localStorage.setItem(
      PAGE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, pages }),
    );
    return true;
  } catch {
    return false;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid layout object");
  return value as Record<string, unknown>;
}
function dimension(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100000
  )
    throw new Error("Invalid layout size");
  return value;
}

/** Only known panels and supported in-app layout forms may be restored. */
export function parseLayoutPreference(
  raw: string | null,
): LayoutPreference | null {
  if (!raw || raw.length > 30000) return null;
  try {
    const preference = object(JSON.parse(raw));
    if (preference.version !== 1 || typeof preference.enabled !== "boolean")
      return null;
    const layout = object(preference.layout);
    if (
      layout.popoutGroups &&
      (!Array.isArray(layout.popoutGroups) || layout.popoutGroups.length)
    )
      return null;
    if (layout.edgeGroups) return null;
    const panels = object(layout.panels);
    const ids = Object.keys(panels);
    if (!ids.length || ids.length > panelIds.length || !ids.every(isEditorPanel)) return null;
    const cleanPanels: SerializedDockview["panels"] = {};
    for (const id of ids) {
      const panel = object(panels[id]);
      if (panel.id !== id || panel.contentComponent !== "editor") return null;
      cleanPanels[id] = {
        id,
        title: panelTitles[id as EditorPanel],
        contentComponent: "editor",
        renderer: "always",
        minimumWidth: 280,
        minimumHeight: id === "output" ? 140 : 220,
      };
    }
    const seen = new Set<string>();
    const groups = new Set<string>();
    function group(value: unknown) {
      const data = object(value);
      if (typeof data.id !== "string" || !data.id || groups.has(data.id))
        throw new Error("Invalid group ID");
      groups.add(data.id);
      if (!Array.isArray(data.views) || !data.views.length)
        throw new Error("Empty group");
      for (const id of data.views) {
        if (!isEditorPanel(id) || !ids.includes(id) || seen.has(id))
          throw new Error("Invalid editor reference");
        seen.add(id);
      }
      if (
        data.activeView !== undefined &&
        !data.views.includes(data.activeView)
      )
        throw new Error("Invalid active editor");
      return {
        id: data.id,
        views: data.views as string[],
        activeView: data.activeView as string | undefined,
      };
    }
    type Grid = SerializedDockview["grid"];
    function node(value: unknown, depth = 0): Grid["root"] {
      if (depth > 8) throw new Error("Layout too deep");
      const data = object(value);
      const size = data.size === undefined ? undefined : dimension(data.size);
      if (data.type === "leaf")
        return { type: "leaf", size, data: group(data.data) };
      if (
        data.type !== "branch" ||
        !Array.isArray(data.data) ||
        data.data.length > panelIds.length
      )
        throw new Error("Invalid layout branch");
      return {
        type: "branch",
        size,
        data: data.data.map((child) => node(child, depth + 1)),
      };
    }
    function grid(value: unknown): Grid {
      const data = object(value);
      if (data.orientation !== "HORIZONTAL" && data.orientation !== "VERTICAL")
        throw new Error("Invalid orientation");
      return {
        width: dimension(data.width),
        height: dimension(data.height),
        orientation: data.orientation as Grid["orientation"],
        root: node(data.root),
      };
    }
    const clean: SerializedDockview = {
      grid: grid(layout.grid),
      panels: cleanPanels,
    };
    if (layout.floatingGroups !== undefined) {
      if (
        !Array.isArray(layout.floatingGroups) ||
        layout.floatingGroups.length > panelIds.length
      )
        return null;
      clean.floatingGroups = layout.floatingGroups.map((value) => {
        const floating = object(value);
        if (Boolean(floating.data) === Boolean(floating.grid))
          throw new Error("Invalid floating group");
        const bounds = object(floating.position);
        const position: Record<string, number> = {
          width: dimension(bounds.width),
          height: dimension(bounds.height),
        };
        for (const key of ["left", "right", "top", "bottom"])
          if (bounds[key] !== undefined) position[key] = dimension(bounds[key]);
        if (
          !("left" in position || "right" in position) ||
          !("top" in position || "bottom" in position)
        )
          throw new Error("Missing floating position");
        return {
          ...(floating.data
            ? { data: group(floating.data) }
            : { grid: grid(floating.grid) }),
          position: position as unknown as NonNullable<
            SerializedDockview["floatingGroups"]
          >[number]["position"],
        };
      });
    }
    if (seen.size !== ids.length) return null;
    if (
      typeof layout.activeGroup === "string" &&
      groups.has(layout.activeGroup)
    )
      clean.activeGroup = layout.activeGroup;
    return { version: 1, enabled: preference.enabled, layout: clean };
  } catch {
    return null;
  }
}

export function readLayoutPreference(): LayoutPreference | null {
  try {
    return parseLayoutPreference(localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return null;
  }
}
export function saveLayoutPreference(
  preference: LayoutPreference | null,
): boolean {
  try {
    if (preference)
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(preference));
    else localStorage.removeItem(LAYOUT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
