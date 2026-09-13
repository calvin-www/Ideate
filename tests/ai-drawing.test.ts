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

describe("drawing text line breaks", () => {
  // Gemini sometimes double-escapes newlines inside function-call strings, so
  // the label arrives as the two characters backslash and n.
  const escaped = "Managed APIs\\n\\nPros: turnkey";
  const board = (addition: Record<string, unknown>) => ({ baseRevision: 4, additions: [addition], updates: [], deleteIds: [], summary: "Add a labeled node" });
  it("turns escaped newlines in shape, text, and arrow labels into real line breaks", () => {
    for (const type of ["rectangle", "text"]) {
      const parsed = validateToolCall("edit_board", board({ type, x: 0, y: 0, width: 320, height: 230, text: escaped })) as { additions: { text: string }[] };
      expect(parsed.additions[0].text).toBe("Managed APIs\n\nPros: turnkey");
    }
    const arrow = validateToolCall("edit_board", board({ type: "arrow", x: 0, y: 0, width: 100, height: 0, text: "yes\\nno" })) as { additions: { text: string }[] };
    expect(arrow.additions[0].text).toBe("yes\nno");
  });
  it("normalizes label updates and nested voice operations, leaving real line breaks alone", () => {
    const updated = validateToolCall("edit_board", { ...board({ type: "text", x: 0, y: 0, width: 10, height: 10 }), additions: [], updates: [{ id: "label-1", text: "one\\ntwo\nthree" }] }) as { updates: { text: string }[] };
    expect(updated.updates[0].text).toBe("one\ntwo\nthree");
    const step = validateToolCall("teach_step", { speech: "Here is the node.", operation: { name: "edit_board", args: board({ type: "diamond", x: 0, y: 0, width: 80, height: 80, text: escaped }) } }) as { operation: { args: { additions: { text: string }[] } } };
    expect(step.operation.args.additions[0].text).toBe("Managed APIs\n\nPros: turnkey");
  });
  it("does not touch escaped newlines in code or notes replacements", () => {
    const args = { baseRevision: 1, replacements: [{ from: 0, to: 0, text: 'print("a\\nb")' }], summary: "Add a print" };
    expect(validateToolCall("edit_code", args)).toEqual(args);
    expect(validateToolCall("edit_notes", args)).toEqual(args);
  });
});
