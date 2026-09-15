import type { OpenEditor } from "./editorDock";
import type { Tool } from "./model";

export type PresetId = "code" | "notes" | "code-notes" | "everything";
export type LayoutPreset = {
  id: PresetId;
  label: string;
  start: Tool;
  opens: OpenEditor[];
};

/** Presets are open commands, not serialized dockview, so they cannot drift. */
export const presets: Record<PresetId, LayoutPreset> = {
  code: { id: "code", label: "Code", start: "code", opens: [] },
  notes: { id: "notes", label: "Notes", start: "notes", opens: [] },
  "code-notes": {
    id: "code-notes",
    label: "Code + Notes",
    start: "code",
    opens: [{ tool: "notes", placement: "right", reference: "code" }],
  },
  everything: {
    id: "everything",
    label: "Everything",
    start: "code",
    opens: [
      { tool: "notes", placement: "right", reference: "code" },
      { tool: "board", placement: "below", reference: "code" },
      { tool: "spreadsheet", placement: "below", reference: "notes" },
    ],
  },
};
export const presetIds: PresetId[] = ["code", "notes", "code-notes", "everything"];
export const isPresetId = (value: unknown): value is PresetId =>
  presetIds.includes(value as PresetId);
export const PRESET_STORAGE_KEY = "ideate:layout-preset:v1";

export function readPresetId(): PresetId {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    return isPresetId(raw) ? raw : "code";
  } catch {
    return "code";
  }
}

export function savePresetId(id: PresetId): boolean {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
