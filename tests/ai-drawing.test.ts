import { describe, expect, it } from "vitest";
import { validateToolCall } from "../src/features/ai/server/tools";

const drawing = (width: number, height: number) => ({ baseRevision: 4, additions: [{ type: "arrow", x: 450, y: 295, width, height, startId: "node-12" }], updates: [], deleteIds: [], summary: "Connect the inserted node" });

describe("drawing connector geometry", () => {
  it.each([[0, 100], [100, 0], [-80, 100], [80, -100]])("accepts signed connector displacement (%s, %s)", (width, height) => {
    const args = drawing(width, height);
    expect(validateToolCall("edit_board", args)).toEqual(args);
    expect(validateToolCall("teach_step", { speech: "Insert eleven here.", operation: { name: "edit_board", args } })).toBeDefined();
  });
  it("still rejects a motionless or oversized connector and zero-sized shapes", () => {
    expect(validateToolCall("edit_board", drawing(0, 0))).toBeUndefined();
    expect(validateToolCall("edit_board", drawing(-10001, 2))).toBeUndefined();
    expect(validateToolCall("edit_board", { ...drawing(0, 20), additions: [{ type: "ellipse", x: 0, y: 0, width: 0, height: 20 }] })).toBeUndefined();
  });
});
