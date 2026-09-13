import { describe, expect, it } from "vitest";
import { clearWorkspaceData } from "../src/features/workspace/clearWorkspace";
import {
  createWorkspace,
  validateWorkspace,
  type Tool,
} from "../src/features/workspace/model";

describe("clearing workspace data", () => {
  it("starts an empty workspace with no conversation, executions, references, or undo history", () => {
    const data = createWorkspace();
    data.messages = [{ id: "message", role: "user", text: "Old question" }];
    data.references = [
      {
        id: "ref",
        tool: "code",
        revision: 0,
        excerpt: "old code",
        label: "Source",
      },
    ];
    data.acceptedOperations = ["old-operation"];
    data.runs = [
      {
        id: "run",
        code: "print(1)",
        revision: 0,
        status: "success",
        output: "1",
        durationMs: 1,
        startedAt: 1,
      },
    ];
    const cleared = clearWorkspaceData(data, "all");
    expect(cleared.id).not.toBe(data.id);
    expect(cleared.code.text).toBe("");
    expect(cleared.notes.text).toBe("");
    for (const key of [
      "messages",
      "runs",
      "references",
      "changes",
      "acceptedOperations",
    ] as const)
      expect(cleared[key]).toEqual([]);
    expect(cleared.board.elements).toEqual([]);
    expect(validateWorkspace(cleared)).toEqual(cleared);
    expect(data.messages).toHaveLength(1);
  });

  it.each<Tool>(["board", "code", "notes"])(
    "clears only %s and invalidates that document's pending edits",
    (target) => {
      const data = createWorkspace();
      data.board.elements = [{ id: "shape", type: "rectangle" }];
      data.changes = ["code", "notes"].map((domain) => ({
        id: `change-${domain}`,
        target: domain as Tool,
        summary: "An edit",
        before: "old",
        after: "new",
        resultRevision: 0,
        sources: [],
      }));
      const cleared = clearWorkspaceData(data, target);
      expect(cleared.id).toBe(data.id);
      expect(cleared[target].revision).toBe(1);
      expect(
        target === "board" ? cleared.board.elements : cleared[target].text,
      ).toEqual(target === "board" ? [] : "");
      for (const other of (["board", "code", "notes"] as const).filter(
        (value) => value !== target,
      ))
        expect(cleared[other]).toBe(data[other]);
      expect(cleared.changes.some((change) => change.target === target)).toBe(
        false,
      );
    },
  );
});
