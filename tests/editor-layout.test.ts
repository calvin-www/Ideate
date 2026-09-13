import { describe, expect, it } from "vitest";
import { parseLayoutPreference } from "../src/features/workspace/layoutPersistence";
import { useWorkspace } from "../src/features/workspace/store";

const saved = () => ({
  version: 1,
  enabled: true,
  layout: {
    grid: { width: 1200, height: 700, orientation: "HORIZONTAL", root: {
      type: "branch", data: [{ type: "leaf", size: 1200, data: { id: "main", views: ["board"], activeView: "board" } }],
    } },
    panels: { board: { id: "board", contentComponent: "editor", title: "Whiteboard" } },
    activeGroup: "main",
  },
});

describe("editor layout preferences", () => {
  it("restores an optional arrangement without storing document content", () => {
    expect(parseLayoutPreference(JSON.stringify(saved()))).toMatchObject({ enabled: true, layout: { panels: { board: { id: "board" } } } });
  });
  it("ignores corrupt JSON, unsupported versions, and invalid panel references", () => {
    expect(parseLayoutPreference("{")).toBeNull();
    expect(parseLayoutPreference(JSON.stringify({ ...saved(), version: 2 }))).toBeNull();
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
    expect(parseLayoutPreference(JSON.stringify({ ...saved(), layout: { ...saved().layout, popoutGroups: [{ url: "/popout.html" }] } }))).toBeNull();
  });
  it("retains floating geometry", () => {
    const value = saved();
    const floating = {
      ...value,
      layout: {
        ...value.layout,
        panels: { ...value.layout.panels, code: { id: "code", contentComponent: "editor" } },
        floatingGroups: [{ data: { id: "float", views: ["code"], activeView: "code" }, position: { left: 120, top: 70, width: 520, height: 430 } }],
      },
    };
    expect(parseLayoutPreference(JSON.stringify(floating))?.layout.floatingGroups?.[0].position).toEqual({ left: 120, top: 70, width: 520, height: 430 });
  });
});

it("changing focused tools does not discard visibility or revise documents", () => {
  const data = useWorkspace.getState().data;
  useWorkspace.setState({ view: "board", visibleTools: ["board", "code"], selection: { tool: "board", revision: 0, ids: ["a"], text: "shape" } });
  useWorkspace.getState().focusTool("code");
  expect(useWorkspace.getState().view).toBe("code");
  expect(useWorkspace.getState().visibleTools).toEqual(["board", "code"]);
  expect(useWorkspace.getState().selection).toBeNull();
  expect(useWorkspace.getState().data).toBe(data);
});
