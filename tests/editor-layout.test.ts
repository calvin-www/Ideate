import { describe, expect, it, vi } from "vitest";
import {
  parseLayoutPreference,
  parsePageLayouts,
  readPageLayouts,
  PAGE_LAYOUT_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  PREVIOUS_ARRANGEMENT_KEY,
  readPreviousArrangement,
  savePreviousArrangement,
  clearPreviousArrangement,
} from "../src/features/workspace/layoutPersistence";
import { useWorkspace } from "../src/features/workspace/store";

const saved = () => ({
  version: 1,
  enabled: true,
  layout: {
    grid: {
      width: 1200,
      height: 700,
      orientation: "HORIZONTAL",
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            size: 1200,
            data: { id: "main", views: ["board"], activeView: "board" },
          },
        ],
      },
    },
    panels: {
      board: { id: "board", contentComponent: "editor", title: "Whiteboard" },
    },
    activeGroup: "main",
  },
});

describe("editor layout preferences", () => {
  it("clears the previous arrangement on reset", () => {
    const values = new Map([[PREVIOUS_ARRANGEMENT_KEY, JSON.stringify(saved())]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    try {
      expect(readPreviousArrangement()).not.toBeNull();
      expect(clearPreviousArrangement()).toBe(true);
      expect(readPreviousArrangement()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("migrates an old arrangement and restores the latest global arrangement thereafter", () => {
    const values = new Map([[PAGE_LAYOUT_STORAGE_KEY, JSON.stringify({ version: 1, pages: { code: saved() } })]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    try {
      expect(readPreviousArrangement()?.layout.panels.board).toBeDefined();
      const changed = saved();
      changed.layout.grid.width = 980;
      expect(savePreviousArrangement(changed as NonNullable<ReturnType<typeof readPreviousArrangement>>)).toBe(true);
      expect(readPreviousArrangement()?.layout.grid.width).toBe(980);
      values.set(PREVIOUS_ARRANGEMENT_KEY, "{");
      expect(readPreviousArrangement()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("retains independent layouts and enabled modes for each header page", () => {
    const pages = parsePageLayouts(
      JSON.stringify({
        version: 1,
        pages: { code: saved(), board: { ...saved(), enabled: false } },
      }),
    );
    expect(pages.code?.enabled).toBe(true);
    expect(pages.board?.enabled).toBe(false);
    expect(pages.notes).toBeUndefined();
  });
  it("ignores one invalid page without discarding other layouts", () => {
    const pages = parsePageLayouts(
      JSON.stringify({
        version: 1,
        pages: { code: saved(), notes: { ...saved(), version: 9 } },
      }),
    );
    expect(pages.code?.layout.panels.board).toBeDefined();
    expect(pages.notes).toBeUndefined();
    expect(parsePageLayouts("{")).toEqual({});
  });
  it("migrates a legacy layout once and respects an explicitly reset page map", () => {
    const values = new Map([[LAYOUT_STORAGE_KEY, JSON.stringify(saved())]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
    });
    try {
      expect(readPageLayouts().board?.enabled).toBe(true);
      values.set(
        PAGE_LAYOUT_STORAGE_KEY,
        JSON.stringify({ version: 1, pages: {} }),
      );
      expect(readPageLayouts()).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("restores output alongside all three editors without making it a document tool", () => {
    const value = saved();
    value.layout.grid.root.data[0].data.views = [
      "board",
      "code",
      "notes",
      "output",
    ];
    Object.assign(value.layout.panels, {
      code: { id: "code", contentComponent: "editor" },
      notes: { id: "notes", contentComponent: "editor" },
      output: { id: "output", contentComponent: "editor" },
    });
    expect(
      parseLayoutPreference(JSON.stringify(value))?.layout.panels.output,
    ).toMatchObject({ id: "output", title: "Output" });
  });
  it("restores an optional arrangement without storing document content", () => {
    expect(parseLayoutPreference(JSON.stringify(saved()))).toMatchObject({
      enabled: true,
      layout: { panels: { board: { id: "board" } } },
    });
  });
  it("ignores corrupt JSON, unsupported versions, and invalid panel references", () => {
    expect(parseLayoutPreference("{")).toBeNull();
    expect(
      parseLayoutPreference(JSON.stringify({ ...saved(), version: 2 })),
    ).toBeNull();
    const invalid = saved();
    invalid.layout.grid.root.data[0].data.views = ["missing"];
    expect(parseLayoutPreference(JSON.stringify(invalid))).toBeNull();
  });
  it("rejects duplicate editor instances and invalid dimensions", () => {
    const invalid = saved();
    invalid.layout.grid.root.data[0].data.views.push("board");
    expect(parseLayoutPreference(JSON.stringify(invalid))).toBeNull();
    const negative = saved();
    negative.layout.grid.width = -1;
    expect(parseLayoutPreference(JSON.stringify(negative))).toBeNull();
  });
  it("does not restore browser popouts from stored layout", () => {
    expect(
      parseLayoutPreference(
        JSON.stringify({
          ...saved(),
          layout: {
            ...saved().layout,
            popoutGroups: [{ url: "/popout.html" }],
          },
        }),
      ),
    ).toBeNull();
  });
  it("retains floating geometry", () => {
    const value = saved();
    const floating = {
      ...value,
      layout: {
        ...value.layout,
        panels: {
          ...value.layout.panels,
          code: { id: "code", contentComponent: "editor" },
        },
        floatingGroups: [
          {
            data: { id: "float", views: ["code"], activeView: "code" },
            position: { left: 120, top: 70, width: 520, height: 430 },
          },
        ],
      },
    };
    expect(
      parseLayoutPreference(JSON.stringify(floating))?.layout
        .floatingGroups?.[0].position,
    ).toEqual({ left: 120, top: 70, width: 520, height: 430 });
  });
});

it("changing focused tools does not discard visibility or revise documents", () => {
  const data = useWorkspace.getState().data;
  useWorkspace.setState({
    view: "board",
    page: "board",
    visibleTools: ["board", "code"],
    selection: { tool: "board", revision: 0, ids: ["a"], text: "shape" },
  });
  useWorkspace.getState().focusTool("code");
  expect(useWorkspace.getState().view).toBe("code");
  expect(useWorkspace.getState().page).toBe("board");
  expect(useWorkspace.getState().visibleTools).toEqual(["board", "code"]);
  expect(useWorkspace.getState().selection).toBeNull();
  expect(useWorkspace.getState().data).toBe(data);
});

it("revealing the current tool retains its selection while a fresh tool launch clears shared context", () => {
  const selection = { tool: "code" as const, revision: 0, from: 0, to: 3, text: "def" };
  useWorkspace.setState({ view: "code", selection });
  useWorkspace.getState().navigate("code", { reveal: true });
  expect(useWorkspace.getState().selection).toBe(selection);
  useWorkspace.getState().navigate("code");
  expect(useWorkspace.getState().selection).toBeNull();
});
