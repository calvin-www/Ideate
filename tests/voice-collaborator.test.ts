import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateToolCall } from "../src/features/ai/server/tools";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";
import { clearPresentation } from "../src/features/voice/presentation";
import { uiResponse } from "./ai-client-fixture";

const args = { text: "Let's start with the lower bound.", operation: { name: "edit_code", args: { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "low = 0\n" }], summary: "Add the lower bound" } } };
const stream = uiResponse;
beforeEach(() => {
  useWorkspace.setState({ data: createWorkspace(), view: "code", jobId: null, selection: null, autoApplyChanges: true });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now() + 20_000));
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { clearPresentation(); vi.unstubAllGlobals(); });

describe("teaching steps", () => {
  it("records identical text and ordered edits with narration off, slow, failed, or stopped", async () => {
    const calls = [
      { type: "call", id: "code-step", name: "teach_step", args },
      { type: "call", id: "note-step", name: "teach_step", args: {
        text: "Record why the bound starts at zero.",
        operation: { name: "edit_notes", args: { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "The lower bound starts at zero.\n" }], summary: "Record the bound" } },
      } },
    ];
    const traces = [];
    for (const mode of ["off", "slow", "failed", "stopped"] as const) {
      useWorkspace.setState({ data: createWorkspace(), view: "code", jobId: null, selection: null, autoApplyChanges: true });
      let finishAudio = () => {};
      const narrate = vi.fn(() => {
        if (mode === "slow") return new Promise<void>((resolve) => { finishAudio = resolve; });
        if (mode === "failed") return Promise.reject(new Error("Speech unavailable"));
        if (mode === "stopped") return Promise.reject(new DOMException("Audio stopped", "AbortError"));
        return Promise.resolve();
      });
      let requests = 0;
      let results: Array<{ id: string; result: { status: string } }> = [];
      const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
        voice: { enabled: () => mode !== "off", context: () => ({}), narrate },
        request: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          if (++requests === 2) results = body.results;
          return stream(requests === 1 ? [...calls, { type: "done" }] : [{ type: "done" }]);
        },
      });

      await client.ask("Explain the lower bound");
      const data = useWorkspace.getState().data;
      traces.push({
        messages: data.messages.map(({ role, text, status }) => ({ role, text, status })),
        code: data.code.text,
        notes: data.notes.text,
        changes: data.changes.map(({ target, summary, before, after, resultRevision }) => ({ target, summary, before, after, resultRevision })),
        results: results.map(({ id, result }) => ({ id, status: result.status })),
      });
      expect(narrate).toHaveBeenCalledTimes(mode === "off" ? 0 : 2);
      finishAudio();
    }
    expect(traces[0].results).toEqual([{ id: "code-step", status: "accepted" }, { id: "note-step", status: "accepted" }]);
    expect(traces[0].changes.map(({ target }) => target)).toEqual(["code", "notes"]);
    expect(traces[0].messages.at(-1)?.text).toBe(`${args.text}\n\nRecord why the bound starts at zero.`);
    for (const trace of traces.slice(1)) expect(trace).toEqual(traces[0]);
  });

  it("accepts canonical text and validates the optional nested edit", () => {
    expect(validateToolCall("teach_step", args)).toEqual(args);
    expect(validateToolCall("teach_step", { speech: args.text })).toBeUndefined();
    expect(validateToolCall("teach_step", { ...args, operation: { name: "run_python", args: { revision: 0 } } })).toBeUndefined();
    expect(validateToolCall("teach_step", { text: " ".repeat(8) })).toBeUndefined();
    expect(validateToolCall("teach_step", { ...args, operation: { name: "edit_code", args: { ...args.operation.args, replacements: [{ from: 5, to: 2, text: "bad" }] } } })).toBeUndefined();
  });

  it("presents and accepts a text-mode step without narration", async () => {
    const narrate = vi.fn();
    let results: Array<{ result: { status: string } }> = [];
    let requests = 0;
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => false, context: () => ({}), narrate },
      request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (++requests === 2) results = body.results;
        return stream(requests === 1 ? [{ type: "call", id: "step", name: "teach_step", args }, { type: "done" }] : [{ type: "done" }]);
      },
    });

    await client.ask("Explain the lower bound");

    expect(narrate).not.toHaveBeenCalled();
    expect(useWorkspace.getState().data.code.text).toContain("low = 0");
    expect(useWorkspace.getState().data.changes).toHaveLength(1);
    expect(useWorkspace.getState().data.messages.at(-1)?.text).toContain(args.text);
    expect(results.map((entry) => entry.result.status)).toEqual(["accepted"]);
  });

  it("returns one ordered operation result while narration is still slow", async () => {
    let finishAudio!: () => void;
    let requests = 0;
    let results: Array<{ id: string; result: { status: string } }> = [];
    const narrate = vi.fn(() => new Promise<void>((resolve) => { finishAudio = resolve; }));
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), narrate },
      request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (++requests === 2) results = body.results;
        return stream(requests === 1 ? [{ type: "call", id: "step", name: "teach_step", args }, { type: "done" }] : [{ type: "done" }]);
      },
    });

    await client.ask("Explain the lower bound");

    expect(narrate).toHaveBeenCalledWith("step", args.text, expect.any(AbortSignal));
    expect(useWorkspace.getState().data.changes).toHaveLength(1);
    expect(results.map(({ id, result }) => [id, result.status])).toEqual([["step", "accepted"]]);
    finishAudio();
  });

  it("continues after its own approved revision without a voice takeover", async () => {
    let client!: ReturnType<typeof createCollaborator>;
    const takeover = vi.fn((event: Event) => {
      if (event.type === "ideate:voice-takeover") client.cancel();
      return true;
    });
    vi.stubGlobal("window", { dispatchEvent: takeover });
    let requests = 0;
    let accepted: string | undefined;
    client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), narrate: vi.fn(), clear: clearPresentation },
      request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (++requests === 2) accepted = body.results?.[0]?.result.status;
        return stream(requests === 1
          ? [{ type: "call", id: "step", name: "teach_step", args }, { type: "done" }]
          : [{ type: "text", text: "The bound is in place." }, { type: "done" }]);
      },
    });

    await client.ask("Explain the lower bound");

    expect(takeover).not.toHaveBeenCalled();
    expect(requests).toBe(2);
    expect(accepted).toBe("accepted");
    expect(useWorkspace.getState().data.messages.at(-1)?.status).toBe("complete");
  });

  it("accepts the same step when narration fails", async () => {
    const onError = vi.fn();
    let requests = 0;
    const client = createCollaborator({ onError, onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), narrate: async () => { throw new Error("Speech unavailable"); } },
      request: async () => stream(++requests === 1 ? [{ type: "call", id: "step", name: "teach_step", args }, { type: "done" }] : [{ type: "done" }]),
    });

    await client.ask("Explain the lower bound");

    expect(useWorkspace.getState().data.changes).toHaveLength(1);
    expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/Speech unavailable/));
  });

  it("does not apply an interrupted visual step even if a frame arrives late", async () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => false, context: () => ({}), narrate: vi.fn() },
      request: async () => stream([{ type: "call", id: "step", name: "teach_step", args }, { type: "done" }]),
    });
    const job = client.ask("Explain");
    await vi.waitFor(() => expect(frame).toBeTypeOf("function"));
    client.cancel();
    frame(performance.now() + 20_000);
    await job;
    expect(useWorkspace.getState().data.changes).toHaveLength(0);
  });

  it("offers long text-only answers for optional ordered narration", async () => {
    const answer = "Each comparison removes half the candidates. ".repeat(45);
    const narrated: string[] = [];
    const client = createCollaborator({ onError: vi.fn(), onPending: vi.fn(), runCode: vi.fn(),
      voice: { enabled: () => true, context: () => ({}), narrate: (_id, text) => { narrated.push(text); } },
      request: async () => stream([{ type: "text", text: answer }, { type: "done" }]),
    });
    await client.ask("Explain in detail");
    expect(narrated.join("")).toBe(answer);
    expect(narrated.every((part) => part.length <= 1200)).toBe(true);
  });
});
