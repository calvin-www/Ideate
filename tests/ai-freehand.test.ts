import { describe, expect, it } from "vitest";
import { validateToolCall } from "../src/features/ai/server/tools";

const stroke = {
  type: "freedraw",
  points: [
    { x: 100, y: 100 },
    { x: 80, y: 140 },
    { x: 150, y: 120 },
  ],
  strokeColor: "#c92a2a",
  strokeWidth: 3,
};
const call = (addition: unknown) => ({
  baseRevision: 3,
  additions: [addition],
  updates: [],
  deleteIds: [],
  summary: "Sketch a curve with the pen",
});

describe("study partner pen tool", () => {
  it("accepts pen strokes alongside existing diagram additions", () => {
    const args = call(stroke);
    args.additions.push({
      type: "text",
      x: 100,
      y: 160,
      width: 80,
      height: 30,
      text: "curve",
    });
    expect(validateToolCall("edit_board", args)).toEqual(args);
  });

  it("accepts horizontal and vertical strokes without invented dimensions", () => {
    for (const points of [
      [
        { x: 10, y: 20 },
        { x: 80, y: 20 },
      ],
      [
        { x: 10, y: 20 },
        { x: 10, y: 90 },
      ],
    ]) {
      const args = call({ type: "freedraw", points });
      expect(validateToolCall("edit_board", args)).toEqual(args);
    }
  });

  it.each([
    ["missing points", { points: undefined }],
    ["empty points", { points: [] }],
    ["one point", { points: [{ x: 0, y: 0 }] }],
    [
      "stationary stroke",
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ],
    [
      "too many points",
      { points: Array.from({ length: 513 }, (_, x) => ({ x, y: 0 })) },
    ],
    [
      "out of bounds",
      {
        points: [
          { x: 0, y: 0 },
          { x: 100001, y: 10 },
        ],
      },
    ],
    [
      "oversized stroke",
      {
        points: [
          { x: 0, y: 0 },
          { x: 10001, y: 10 },
        ],
      },
    ],
    [
      "nonfinite coordinate",
      {
        points: [
          { x: 0, y: 0 },
          { x: Infinity, y: 10 },
        ],
      },
    ],
    [
      "malformed point",
      {
        points: [
          [0, 0],
          [10, 10],
        ],
      },
    ],
    ["invalid color", { strokeColor: "url(https://example.com)" }],
    ["invisible width", { strokeWidth: 0 }],
    ["oversized width", { strokeWidth: 100 }],
    ["injected metadata", { isDeleted: true }],
    ["binding on a stroke", { startId: "shape" }],
  ])("rejects %s", (_name, invalid) => {
    expect(
      validateToolCall("edit_board", call({ ...stroke, ...invalid })),
    ).toBeUndefined();
  });
});
