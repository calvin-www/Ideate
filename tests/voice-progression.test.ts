import { describe, expect, it } from "vitest";
import { textFrame, boardFrame } from "../src/features/voice/progression";

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
});
