import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESET_STORAGE_KEY,
  isPresetId,
  presetIds,
  presets,
  readPresetId,
  savePresetId,
} from "../src/features/workspace/presets";

// Node test environment: stub storage like tests/partner-defaults.test.ts.
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("layout presets", () => {

  it("declares four presets whose open commands only reference panels already on screen", () => {
    expect(presetIds).toEqual(["code", "notes", "code-notes", "everything"]);
    for (const id of presetIds) {
      const preset = presets[id];
      const onScreen = new Set<string>([preset.start]);
      for (const open of preset.opens) {
        expect(onScreen.has(open.reference), `${id}: ${open.tool} references ${open.reference}`).toBe(true);
        expect(onScreen.has(open.tool)).toBe(false);
        onScreen.add(open.tool);
      }
    }
    expect(presets.code.opens).toEqual([]);
    expect(presets.notes.start).toBe("notes");
    expect(presets["code-notes"].opens.map((o) => o.tool)).toEqual(["notes"]);
    expect(presets.everything.opens.map((o) => o.tool).sort()).toEqual(["board", "notes", "spreadsheet"]);
  });

  it("remembers the last preset and defaults to code", () => {
    expect(readPresetId()).toBe("code");
    expect(savePresetId("everything")).toBe(true);
    expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBe("everything");
    expect(readPresetId()).toBe("everything");
    localStorage.setItem(PRESET_STORAGE_KEY, "bogus");
    expect(readPresetId()).toBe("code");
    expect(isPresetId("notes")).toBe(true);
    expect(isPresetId("desk")).toBe(false);
  });
});
