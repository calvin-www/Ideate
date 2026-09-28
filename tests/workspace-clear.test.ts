import { describe, expect, it, vi } from "vitest";
const savedWorkspace = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("idb-keyval", () => ({
  get: async () => savedWorkspace.value,
  set: async (_key: string, value: unknown) => {
    savedWorkspace.value = value;
  },
}));
import { clearWorkspaceData } from "../src/features/workspace/clearWorkspace";
import {
  createWorkspace,
  validateWorkspace,
  type Tool,
} from "../src/features/workspace/model";
import { hydrateWorkspace, useWorkspace } from "../src/features/workspace/store";

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

it("clears a pending notes reveal when resetting the whole workspace", () => {
  const previous = useWorkspace.getState();
  try {
    useWorkspace.setState({
      data: createWorkspace(),
      hydrated: false,
      view: "code",
      page: "code",
      navigationEpoch: 0,
      navigationReveal: null,
      navigationPreset: null,
      visibleTools: ["notes"],
      boardPreview: "old preview",
      selection: {
        tool: "notes",
        revision: 0,
        text: "old selection",
      },
    });
    useWorkspace.getState().navigate("notes", { reveal: true });
    useWorkspace.setState({
      selection: { tool: "notes", revision: 0, text: "old selection" },
      attention: {
        notes: {
          id: "cue",
          jobId: "job",
          workspaceId: useWorkspace.getState().data.id,
          target: "notes",
          revision: 0,
          mode: "point",
          label: "Old cue",
          from: 0,
          to: 0,
        },
      },
    });
    const revealedEpoch = useWorkspace.getState().navigationEpoch;

    useWorkspace.getState().clearData("all");

    expect(useWorkspace.getState()).toMatchObject({
      view: "code",
      page: "code",
      visited: ["code"],
      visibleTools: [],
      navigationPreset: "code",
      navigationReveal: null,
      navigationEpoch: revealedEpoch + 1,
      selection: null,
      attention: {},
      boardPreview: "",
    });
  } finally {
    useWorkspace.setState(previous, true);
  }
});

it("shows a persisted paused answer as interrupted after hydration", async () => {
  const data = createWorkspace();
  data.messages = [
    { id: "partial", role: "assistant", text: "An unfinished answer", status: "paused" },
  ];
  savedWorkspace.value = data;

  await hydrateWorkspace({ view: "code", preset: "code" });

  expect(useWorkspace.getState().data.messages).toMatchObject([
    { id: "partial", text: "An unfinished answer", status: "interrupted" },
  ]);
});
