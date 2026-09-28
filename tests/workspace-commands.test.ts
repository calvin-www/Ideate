import { beforeEach, expect, it } from "vitest";
import { workspaceCommands } from "../src/features/workspace/commands";
import { createWorkspace, type Proposal } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";

function codeProposal(): Proposal {
  return {
    id: "edit-1",
    jobId: "job-1",
    target: "code",
    baseRevision: 0,
    summary: "Add example",
    replacements: [{ from: 0, to: 0, text: "print(1)" }],
    sources: [],
    sourceRevisions: {},
  };
}

beforeEach(() => {
  useWorkspace.setState({ data: createWorkspace(), jobId: "job-1" });
});

it("applies a reviewed edit once and returns the committed revision", async () => {
  const pending = await workspaceCommands.propose(codeProposal());
  expect(pending.preview).toBe("print(1)");

  expect(workspaceCommands.apply(pending)).toEqual({
    status: "accepted",
    target: "code",
    revision: 1,
    operationId: "edit-1",
  });
  expect(workspaceCommands.snapshot().code.text).toBe("print(1)");
  expect(() => workspaceCommands.apply(pending)).toThrow(/already applied/);
});

it("rejects a delayed edit after manual changes or workspace import", async () => {
  const delayed = await workspaceCommands.propose(codeProposal());
  useWorkspace.getState().setText("code", "my edit");
  expect(() => workspaceCommands.apply(delayed)).toThrow(/document changed/);
  expect(workspaceCommands.snapshot().code.text).toBe("my edit");

  useWorkspace.setState({ data: createWorkspace(), jobId: "job-1" });
  const replaced = await workspaceCommands.propose(codeProposal());
  workspaceCommands.replace(createWorkspace());
  expect(() => workspaceCommands.apply(replaced)).toThrow(/cancelled/);
  expect(workspaceCommands.snapshot().code.text).toBe("");
});

it("returns an explicit rejection without changing the workspace", async () => {
  const pending = await workspaceCommands.propose(codeProposal());
  expect(workspaceCommands.reject(pending)).toEqual({
    status: "rejected",
    message: "The student rejected the proposed change. No change was applied.",
  });
  expect(workspaceCommands.snapshot().changes).toEqual([]);
});
