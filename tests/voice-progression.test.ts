import { describe, expect, it } from "vitest";
import {
  boardChangedElements,
  boardFrame,
  boardRenderElements,
  checkpointBoard,
  textFrame,
} from "../src/features/voice/progression";

describe("progressive workspace presentation", () => {
  it("reveals complete inserted lines without changing the source", () => {
    const before = "# example\n";
    const replacements = [{ from: 10, to: 10, text: "low = 0\nhigh = 9\nmid = 4\n" }];
    expect(textFrame(before, replacements, 0)).toBe(before);
    expect(textFrame(before, replacements, 0.4)).toBe("# example\nlow = 0\n");
    expect(textFrame(before, replacements, 1)).toBe("# example\nlow = 0\nhigh = 9\nmid = 4\n");
    expect(before).toBe("# example\n");
  });

  it("keeps offsets tied to the original when several ranges change", () => {
    expect(textFrame("abc def", [{ from: 0, to: 3, text: "A" }, { from: 4, to: 7, text: "D" }], 1)).toBe("A D");
  });

  it("traces a new stroke without modifying existing elements", () => {
    const old = { id: "old", type: "text", text: "Range" };
    const stroke = { id: "stroke", type: "freedraw", points: [[0, 0], [100, 0], [100, 100]] };
    const halfway = boardFrame([old], [old, stroke], 0.5);
    expect(halfway[0]).toEqual(old);
    expect(halfway[1].points).toEqual([[0, 0], [100, 0]]);
    expect(stroke.points).toEqual([[0, 0], [100, 0], [100, 100]]);
    expect(boardFrame([old], [old, stroke], 0)).toEqual([old]);
    expect(boardFrame([old], [old, stroke], 1)).toEqual([old, stroke]);
  });

  it("keeps an element visible until its deletion step completes", () => {
    const original = {
      id: "box",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
      strokeColor: "#123456",
    };
    const deleted = { ...original, isDeleted: true };

    expect(boardFrame([original], [deleted], 0.5)).toEqual([original]);
    expect(boardFrame([original], [deleted], 1)).toEqual([deleted]);
    expect(original).not.toHaveProperty("voiceProgress");
  });

  it("replaces an updated element in the detached frame without duplicating it", () => {
    const original = {
      id: "label",
      type: "text",
      x: 0,
      y: 0,
      text: "Old label",
    };
    const updated = { ...original, x: 80, text: "New label" };

    expect(boardFrame([original], [updated], 0.5)).toEqual([original]);
    expect(boardFrame([original], [updated], 1)).toEqual([updated]);
    expect(boardFrame([original], [updated], 1)).toHaveLength(1);
  });

  it("makes the beginning of a long pen stroke visible while it keeps growing", () => {
    const stroke = {
      id: "stroke",
      type: "freedraw",
      points: [
        [0, 0],
        [80, 0],
        [160, 0],
        [240, 60],
        [240, 140],
      ],
    };

    const early = boardFrame([], [stroke], 0.01)[0];
    const later = boardFrame([], [stroke], 0.25)[0];
    expect((early.points as number[][]).at(-1)?.[0]).toBeGreaterThan(20);
    expect((later.points as number[][]).at(-1)?.[0]).toBeGreaterThan(
      (early.points as number[][]).at(-1)?.[0] ?? 0,
    );
  });

  it.each(["rectangle", "ellipse", "diamond"])(
    "draws a new %s as a persistable pen outline before restoring its editable type",
    (type) => {
      const shape = {
        id: type,
        type,
        x: 20,
        y: 30,
        width: 120,
        height: 80,
        strokeColor: "#123456",
        strokeWidth: 3,
        backgroundColor: "#eeeeee",
      };

      const partial = boardFrame([], [shape], 0.25)[0];
      expect(partial.type).toBe("freedraw");
      expect(partial.points).toEqual(expect.arrayContaining([[0, 0]]));
      expect(partial.width).toBeGreaterThan(0);
      expect(partial.height).toBeGreaterThanOrEqual(0);
      expect(partial).not.toHaveProperty("voiceProgress");
      expect(boardFrame([], [shape], 1)).toEqual([shape]);
      expect(shape.type).toBe(type);
    },
  );

  it("keeps an existing editable shape unchanged until its update is ready", () => {
    const old = {
      id: "shape",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 60,
    };
    const updated = { ...old, x: 200, width: 140 };

    expect(boardFrame([old], [updated], 0.5)).toEqual([old]);
    expect(boardFrame([old], [updated], 1)).toEqual([updated]);
  });

  it("recomputes dimensions for a partial native linear element", () => {
    const stroke = {
      id: "line",
      type: "freedraw",
      x: 40,
      y: 50,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    };

    expect(boardFrame([], [stroke], 0.5)[0]).toMatchObject({
      x: 40,
      y: 50,
      width: 100,
      height: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
    });
  });

  it("clones a visible checkpoint and removes dangling board relationships", () => {
    const elements = [
      {
        id: "target",
        type: "rectangle",
        boundElements: [
          { id: "arrow", type: "arrow" },
          { id: "missing", type: "text" },
        ],
      },
      { id: "gone", type: "ellipse", isDeleted: true },
      {
        id: "arrow",
        type: "arrow",
        points: [
          [0, 0],
          [20, 20],
        ],
        voiceProgress: 0.4,
        startBinding: { elementId: "target", focus: 0, gap: 1 },
        endBinding: { elementId: "gone", focus: 0, gap: 1 },
      },
      { id: "label", type: "text", text: "Label", containerId: "missing" },
      {
        id: "partial-shape",
        type: "freedraw",
        points: [[0, 0], [30, 0]],
        boundElements: [{ id: "partial-label", type: "text" }],
      },
      {
        id: "partial-label",
        type: "text",
        text: "Unfinished",
        containerId: "partial-shape",
      },
    ];

    const checkpoint = checkpointBoard(elements);
    expect(checkpoint).not.toBe(elements);
    expect(checkpoint[0]).not.toBe(elements[0]);
    expect(checkpoint[0].boundElements).toEqual([
      { id: "arrow", type: "arrow" },
    ]);
    expect(checkpoint[2]).not.toHaveProperty("voiceProgress");
    expect(checkpoint[2].startBinding).toEqual({
      elementId: "target",
      focus: 0,
      gap: 1,
    });
    expect(checkpoint[2].endBinding).toBeNull();
    expect(checkpoint[3].containerId).toBeNull();
    expect(checkpoint[4].boundElements).toEqual([]);
    expect(checkpoint[5].containerId).toBeNull();
    expect(elements[2]).toHaveProperty("voiceProgress", 0.4);
    expect((elements[0].boundElements as unknown[])).toHaveLength(2);
  });

  it("builds a visible scene and scroll targets for updates and deletions", () => {
    const oldLabel = { id: "label", type: "text", text: "Old" };
    const oldBox = { id: "box", type: "rectangle", x: 10, y: 20 };
    const stable = { id: "stable", type: "ellipse", x: 200, y: 20 };
    const newLabel = { ...oldLabel, text: "New" };
    const deletedBox = { ...oldBox, isDeleted: true };
    const before = [oldLabel, oldBox, stable];
    const after = [newLabel, deletedBox, stable];

    expect(boardRenderElements(after)).toEqual([newLabel, stable]);
    expect(boardChangedElements(before, after)).toEqual([newLabel, oldBox]);
  });
});
