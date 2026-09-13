import type { SerializedDockview } from "dockview-react";
import type { Tool } from "./model";

export const LAYOUT_STORAGE_KEY = "ideate:editor-layout:v1";
export const toolTitles: Record<Tool, string> = { board: "Whiteboard", code: "Python", notes: "Journal" };
export const tools: Tool[] = ["board", "code", "notes"];
export const isTool = (id: unknown): id is Tool => tools.includes(id as Tool);
export type LayoutPreference = { version: 1; enabled: boolean; layout: SerializedDockview };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid layout object");
  return value as Record<string, unknown>;
}
function dimension(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100000) throw new Error("Invalid layout size");
  return value;
}

/** Only the three known editor IDs and the supported in-app layout forms may be restored. */
export function parseLayoutPreference(raw: string | null): LayoutPreference | null {
  if (!raw || raw.length > 30000) return null;
  try {
    const preference = object(JSON.parse(raw));
    if (preference.version !== 1 || typeof preference.enabled !== "boolean") return null;
    const layout = object(preference.layout);
    if (layout.popoutGroups && (!Array.isArray(layout.popoutGroups) || layout.popoutGroups.length)) return null;
    if (layout.edgeGroups) return null;
    const panels = object(layout.panels);
    const ids = Object.keys(panels);
    if (!ids.length || ids.length > 3 || !ids.every(isTool)) return null;
    const cleanPanels: SerializedDockview["panels"] = {};
    for (const id of ids) {
      const panel = object(panels[id]);
      if (panel.id !== id || panel.contentComponent !== "editor") return null;
      cleanPanels[id] = { id, title: toolTitles[id as Tool], contentComponent: "editor", renderer: "always", minimumWidth: 280, minimumHeight: 220 };
    }
    const seen = new Set<string>();
    const groups = new Set<string>();
    function group(value: unknown) {
      const data = object(value);
      if (typeof data.id !== "string" || !data.id || groups.has(data.id)) throw new Error("Invalid group ID");
      groups.add(data.id);
      if (!Array.isArray(data.views) || !data.views.length) throw new Error("Empty group");
      for (const id of data.views) {
        if (!isTool(id) || !ids.includes(id) || seen.has(id)) throw new Error("Invalid editor reference");
        seen.add(id);
      }
      if (data.activeView !== undefined && !data.views.includes(data.activeView)) throw new Error("Invalid active editor");
      return { id: data.id, views: data.views as string[], activeView: data.activeView as string | undefined };
    }
    type Grid = SerializedDockview["grid"];
    function node(value: unknown, depth = 0): Grid["root"] {
      if (depth > 8) throw new Error("Layout too deep");
      const data = object(value);
      const size = data.size === undefined ? undefined : dimension(data.size);
      if (data.type === "leaf") return { type: "leaf", size, data: group(data.data) };
      if (data.type !== "branch" || !Array.isArray(data.data) || data.data.length > 3) throw new Error("Invalid layout branch");
      return { type: "branch", size, data: data.data.map((child) => node(child, depth + 1)) };
    }
    function grid(value: unknown): Grid {
      const data = object(value);
      if (data.orientation !== "HORIZONTAL" && data.orientation !== "VERTICAL") throw new Error("Invalid orientation");
      return { width: dimension(data.width), height: dimension(data.height), orientation: data.orientation as Grid["orientation"], root: node(data.root) };
    }
    const clean: SerializedDockview = { grid: grid(layout.grid), panels: cleanPanels };
    if (layout.floatingGroups !== undefined) {
      if (!Array.isArray(layout.floatingGroups) || layout.floatingGroups.length > 3) return null;
      clean.floatingGroups = layout.floatingGroups.map((value) => {
        const floating = object(value);
        if (Boolean(floating.data) === Boolean(floating.grid)) throw new Error("Invalid floating group");
        const bounds = object(floating.position);
        const position: Record<string, number> = { width: dimension(bounds.width), height: dimension(bounds.height) };
        for (const key of ["left", "right", "top", "bottom"]) if (bounds[key] !== undefined) position[key] = dimension(bounds[key]);
        if (!("left" in position || "right" in position) || !("top" in position || "bottom" in position)) throw new Error("Missing floating position");
        return { ...(floating.data ? { data: group(floating.data) } : { grid: grid(floating.grid) }), position: position as unknown as NonNullable<SerializedDockview["floatingGroups"]>[number]["position"] };
      });
    }
    if (seen.size !== ids.length) return null;
    if (typeof layout.activeGroup === "string" && groups.has(layout.activeGroup)) clean.activeGroup = layout.activeGroup;
    return { version: 1, enabled: preference.enabled, layout: clean };
  } catch {
    return null;
  }
}

export function readLayoutPreference(): LayoutPreference | null {
  try { return parseLayoutPreference(localStorage.getItem(LAYOUT_STORAGE_KEY)); } catch { return null; }
}
export function saveLayoutPreference(preference: LayoutPreference | null): boolean {
  try {
    if (preference) localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(preference));
    else localStorage.removeItem(LAYOUT_STORAGE_KEY);
    return true;
  } catch { return false; }
}
