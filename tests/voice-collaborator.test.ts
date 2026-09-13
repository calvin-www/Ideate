import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateToolCall } from "../src/features/ai/server/tools";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";

const args = { speech: "Let's start with the lower bound.", operation: { name: "edit_code", args: { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "low = 0\n" }], summary: "Add the lower bound" } } };
const stream = (events: unknown[]) => new Response(events.map((value) => JSON.stringify(value)).join("\n") + "\n");
beforeEach(() => useWorkspace.setState({ data: createWorkspace(), view: "code", jobId: null, selection: null, autoApplyChanges: true }));

describe("paired teaching steps", () => {
  it("speaks the complete text-only fallback instead of truncating it", async () => {
    const answer = "Each comparison removes half the candidates. ".repeat(45);
    const spoken: string[] = [];
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), play: async (text) => { spoken.push(text); } },
      request: async () => stream([{ type: "text", text: answer }, { type: "done", continuation: { contents: [] } }]),
    });
    await client.ask("Explain in detail");
    expect(spoken.join("")).toBe(answer);
    expect(spoken.every((part) => part.length <= 1200)).toBe(true);
  });

  it("validates the nested edit using the existing revision contract", () => {
    expect(validateToolCall("teach_step", args)).toEqual(args);
    expect(validateToolCall("teach_step", { ...args, operation: { name: "run_python", args: { revision: 0 } } })).toBeUndefined();
    expect(validateToolCall("teach_step", { speech: " ".repeat(8) })).toBeUndefined();
    expect(validateToolCall("teach_step", { ...args, operation: { name: "edit_code", args: { ...args.operation.args, replacements: [{ from: 5, to: 2, text: "bad" }] } } })).toBeUndefined();
  });

  it("commits only after playback completes", async () => {
    let finish!: () => void, started = false, requests = 0;
    const original = useWorkspace.getState().data.code.text;
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), play: async () => { started = true; await new Promise<void>((resolve) => { finish = resolve; }); } },
      request: async () => stream(++requests === 1 ? [{ type: "call", id: "step", name: "teach_step", args }, { type: "done", continuation: { contents: [] } }] : [{ type: "done", continuation: { contents: [] } }]),
    });
    const job = client.ask("Explain the lower bound");
    await vi.waitFor(() => expect(started).toBe(true));
    expect(useWorkspace.getState().data.code.text).toBe(original);
    finish(); await job;
    expect(useWorkspace.getState().data.code.text).toBe("low = 0\n" + original);
    expect(useWorkspace.getState().data.changes).toHaveLength(1);
  });

  it("does not apply an interrupted step even if playback resolves late", async () => {
    let finish!: () => void, started = false;
    const original = useWorkspace.getState().data.code.text;
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), play: async () => { started = true; await new Promise<void>((resolve) => { finish = resolve; }); } },
      request: async () => stream([{ type: "call", id: "step", name: "teach_step", args }, { type: "done", continuation: { contents: [] } }]),
    });
    const job = client.ask("Explain");
    await vi.waitFor(() => expect(started).toBe(true));
    client.cancel(); finish(); await job;
    expect(useWorkspace.getState().data.code.text).toBe(original);
    expect(useWorkspace.getState().data.changes).toHaveLength(0);
  });

  it("also holds standalone voice edits until their speech finishes", async () => {
    let finish!: () => void, started = false, requests = 0;
    const original = useWorkspace.getState().data.code.text;
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), play: async () => { started = true; await new Promise<void>((resolve) => { finish = resolve; }); } },
      request: async () => stream(++requests === 1 ? [{ type: "call", id: "step", ...args.operation }, { type: "done", continuation: { contents: [] } }] : [{ type: "done", continuation: { contents: [] } }]),
    });
    const job = client.ask("Add the lower bound");
    await vi.waitFor(() => expect(started).toBe(true));
    expect(useWorkspace.getState().data.code.text).toBe(original);
    finish(); await job;
    expect(useWorkspace.getState().data.code.text).toBe("low = 0\n" + original);
  });
});
