import { describe, expect, it } from "vitest";
import {
  TOOL_DRAG_TYPE,
  beginToolDrag,
  draggedTool,
  dropCommand,
  endToolDrag,
  isToolDrag,
  placementFromPosition,
} from "../src/features/workspace/toolDrag";

function fakeTransfer() {
  const data = new Map<string, string>();
  const transfer = {
    types: [] as string[],
    effectAllowed: "uninitialized",
    setData(type: string, value: string) {
      data.set(type, value);
      transfer.types = [...data.keys()];
    },
    getData(type: string) {
      return data.get(type) ?? "";
    },
  };
  return transfer as unknown as DataTransfer;
}

describe("tool drag payload", () => {
  it("records the dragged tool for the duration of the drag", () => {
    const transfer = fakeTransfer();
    beginToolDrag("notes", transfer);
    expect(draggedTool()).toBe("notes");
    expect(isToolDrag(transfer)).toBe(true);
    expect(transfer.getData(TOOL_DRAG_TYPE)).toBe("notes");
    endToolDrag();
    expect(draggedTool()).toBeNull();
    expect(draggedTool(transfer)).toBe("notes");
  });
  it("ignores foreign drags", () => {
    const transfer = fakeTransfer();
    transfer.setData("text/plain", "notes");
    expect(isToolDrag(transfer)).toBe(false);
    expect(draggedTool(transfer)).toBeNull();
    expect(draggedTool(null)).toBeNull();
  });
});

describe("drop mapping", () => {
  it("maps Dockview positions to placements", () => {
    expect(placementFromPosition("left")).toBe("left");
    expect(placementFromPosition("right")).toBe("right");
    expect(placementFromPosition("top")).toBe("above");
    expect(placementFromPosition("bottom")).toBe("below");
    expect(placementFromPosition("center")).toBe("within");
  });
  it("anchors to the drop group's active panel, else the focused panel", () => {
    expect(
      dropCommand({ tool: "notes", position: "bottom", reference: "code", fallback: "board" }),
    ).toEqual({ tool: "notes", placement: "below", reference: "code" });
    expect(
      dropCommand({ tool: "notes", position: "center", reference: undefined, fallback: "board" }),
    ).toEqual({ tool: "notes", placement: "within", reference: "board" });
  });
  it("always anchors output to Python", () => {
    expect(
      dropCommand({ tool: "output", position: "right", reference: "notes", fallback: "board" }),
    ).toEqual({ tool: "output", placement: "right", reference: "code" });
  });
});
