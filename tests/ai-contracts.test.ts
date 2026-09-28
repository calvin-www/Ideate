import { describe, expect, expectTypeOf, it } from "vitest";
import {
  parseOperation,
  type StudyBackend,
  type StudyEvent,
} from "../src/features/ai/contracts";
import { captureContext } from "../src/features/ai/context";
import { createWorkspace, type BoardElement, type Proposal } from "../src/features/workspace/model";

const textArgs = {
  baseRevision: 0,
  replacements: [{ from: 0, to: 0, text: "print(1)" }],
  summary: "Add a print statement",
};
const boardArgs = {
  baseRevision: 0,
  additions: [{ type: "rectangle", x: 0, y: 0, width: 20, height: 20 }],
  updates: [],
  deleteIds: [],
  summary: "Add a box",
};

describe("study operation contract", () => {
  it("keeps board and text proposal payloads disjoint", () => {
    const common = {
      id: "proposal-1",
      jobId: "job-1",
      baseRevision: 0,
      summary: "A change",
      sources: [],
      sourceRevisions: {},
    };
    // @ts-expect-error Board proposals cannot carry text replacements.
    const board: Proposal = { ...common, target: "board", boardPatch: {}, replacements: textArgs.replacements };
    // @ts-expect-error Text proposals cannot carry a board patch.
    const text: Proposal = { ...common, target: "code", replacements: textArgs.replacements, boardPatch: {} };
    expect(board.target).toBe("board");
    expect(text.target).toBe("code");
  });

  it("types persisted board elements by the serialization fields", () => {
    const element: BoardElement = { id: "box", type: "rectangle", x: 1 };
    // @ts-expect-error Arbitrary provider fields are not persisted board fields.
    element.providerMetadata = "opaque";
    expect(element.id).toBe("box");
  });

  it("narrows arguments by operation name and rejects mixed edit payloads", () => {
    const text = parseOperation("edit_code", textArgs);
    expect(text?.name).toBe("edit_code");
    if (text?.name !== "edit_code") throw new Error("Expected a code operation");
    expectTypeOf(text.args.replacements).toEqualTypeOf<typeof textArgs.replacements>();
    // @ts-expect-error A code operation has no board additions.
    text.args.additions;

    const board = parseOperation("edit_board", boardArgs);
    expect(board?.name).toBe("edit_board");
    if (board?.name !== "edit_board") throw new Error("Expected a board operation");
    expectTypeOf(board.args.additions).toBeArray();
    // @ts-expect-error A board operation has no text replacements.
    board.args.replacements;

    expect(parseOperation("edit_board", { ...boardArgs, replacements: textArgs.replacements })).toBeUndefined();
    expect(parseOperation("edit_code", { ...textArgs, boardPatch: boardArgs })).toBeUndefined();
  });

  it("lets a provider-free backend emit a recorded study turn", async () => {
    const backend: StudyBackend = {
      async *advance(input) {
        if (input.type === "start") {
          yield { type: "text", text: "Try a small example." };
          yield { type: "operationBatch", operations: [
            { id: "edit-1", operation: parseOperation("edit_code", textArgs)! },
          ] };
        } else {
          yield { type: "done" };
        }
      },
    };
    const events: StudyEvent[] = [];
    for await (const event of backend.advance(
      { type: "start", messages: [{ role: "user", text: "Show a print" }], context: {} },
      new AbortController().signal,
    )) events.push(event);

    expect(events.map((event) => event.type)).toEqual(["text", "operationBatch"]);
  });
});

it("captures a bounded workspace snapshot independent of later edits", () => {
  const workspace = createWorkspace();
  workspace.board.elements = [{ id: "box", type: "rectangle", x: 1, y: 2, width: 20, height: 20 }];
  workspace.code.text = "print(1)";
  const selection = { tool: "board" as const, revision: 0, text: "A box", ids: ["box"] };
  const captured = captureContext({ data: workspace, view: "board" }, selection);
  const original = JSON.stringify(captured);

  workspace.board.elements[0].x = 99;
  workspace.code.text = "print(2)";
  selection.ids.push("another");

  expect(JSON.stringify(captured)).toBe(original);
  expect(JSON.stringify(captured)).toContain('"x":1');
  expect(JSON.stringify(captured)).toContain('"text":"print(1)"');
});
