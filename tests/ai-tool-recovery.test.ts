import { describe, expect, it } from "vitest";
import type { Content, GenerateContentResponse, Part } from "@google/genai";
import { handleAiRequest } from "../src/features/ai/server/handler";
import { createRateLimiter, parseAiRequest } from "../src/features/ai/server/validation";
import { createBudgetStore } from "../src/features/ai/server/budget";
import { buildContents } from "../src/features/ai/server/provider";
import { createCollaborator, type PendingChange } from "../src/features/ai/useCollaborator";
import { createWorkspace } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";

const initial = { messages: [{ role: "user", text: "Draw a small explanation" }], context: {} };
const limits = { generation: 8, total: 64, recoveries: 2 };
const request = (extra = {}, signal?: AbortSignal) => new Request("http://localhost:3000/api/ai", {
  method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
  body: JSON.stringify({ ...initial, ...extra }), signal,
});
const chunk = (parts: unknown[], finishReason = "STOP", usage = true) => ({
  candidates: [{ content: { role: "model", parts }, finishReason }],
  ...(usage ? { usageMetadata: { candidatesTokenCount: 1, thoughtsTokenCount: 1 } } : {}),
}) as GenerateContentResponse;
const invalid: Part = { functionCall: { id: "draw", name: "edit_board", args: { baseRevision: 0 } }, thoughtSignature: "signed-invalid-args" };
const valid: Part = { functionCall: { id: "read", name: "read_board", args: {} }, thoughtSignature: "signed-read" };
const events = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
const visibleText = (items: Array<{ type: string; text?: string }>) => items.reduce((text, item) => item.type === "replace" ? item.text! : item.type === "text" ? text + item.text : text, "");

describe("invalid tool recovery", () => {
  it("repairs the whole batch before emitting and preserves signed parts and response IDs", async () => {
    const inputs: Content[][] = [];
    const firstParts: Part[] = [{ text: "Discard this explanation.", thoughtSignature: "signed-text" }, valid, invalid];
    const result = await events(await handleAiRequest(request(), {
      limits, limiter: createRateLimiter(100),
      generate: async (contents) => {
        inputs.push(structuredClone(contents));
        return (async function* () { yield inputs.length === 1 ? chunk(firstParts) : chunk([{ text: "Corrected." }, valid]); })();
      },
    }));
    expect(inputs).toHaveLength(2);
    expect(inputs[1].at(-2)?.parts).toEqual(firstParts);
    const responses = inputs[1].at(-1)!.parts!.filter((part) => part.functionResponse).map((part) => part.functionResponse!);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ id: "read", name: "read_board", response: { output: { status: "not_executed" } } });
    expect(responses[1]).toMatchObject({ id: "draw", name: "edit_board", response: { output: { status: "invalid_arguments", issues: expect.any(Array) } } });
    expect(JSON.stringify(responses[1])).toContain("additions");
    expect(result.filter((event) => event.type === "call")).toEqual([{ type: "call", id: "read", name: "read_board", args: {} }]);
    expect(visibleText(result)).toBe("Corrected.");
    expect(result.some((event) => event.type === "status")).toBe(true);
    expect(result.at(-1).type).toBe("done");
    const continued = parseAiRequest({ ...initial, continuation: result.at(-1).continuation, toolResults: [{ id: "read", name: "read_board", result: {} }] });
    expect(buildContents(continued).at(-1)?.parts?.[0].functionResponse?.name).toBe("read_board");
  });

  it.each([
    [{ functionCall: { name: "unavailable_tool", args: {} } }],
    [{ functionCall: { name: "read_board", id: "", args: {} } }],
    [{ functionCall: { name: "read_board", args: [] } }],
    [{ functionCall: { args: {} } }],
    [valid, valid],
  ])("regenerates malformed envelopes without poisoning future continuations: %j", async (...parts) => {
    const inputs: Content[][] = [];
    const result = await events(await handleAiRequest(request(), {
      limits, limiter: createRateLimiter(100),
      generate: async (contents) => {
        inputs.push(structuredClone(contents));
        return (async function* () { yield inputs.length === 1 ? chunk(parts) : chunk([valid]); })();
      },
    }));
    expect(inputs).toHaveLength(2);
    expect(inputs[1].slice(0, -1)).toEqual(inputs[0]);
    expect(inputs[1].at(-1)?.parts?.every((part) => part.text && !part.functionResponse)).toBe(true);
    expect(result.filter((event) => event.type === "call")).toHaveLength(1);
    expect(() => parseAiRequest({ ...initial, continuation: result.at(-1).continuation, toolResults: [{ id: "read", name: "read_board", result: {} }] })).not.toThrow();
  });

  it("uses the same two-recovery limit even when STOP usage leaves tokens", async () => {
    const allowances: number[] = [];
    const result = await events(await handleAiRequest(request(), {
      limits, limiter: createRateLimiter(100),
      generate: async (_contents, _signal, allowance) => {
        allowances.push(allowance);
        return (async function* () { yield chunk([invalid]); })();
      },
    }));
    expect(allowances).toEqual([8, 8, 8]);
    expect(result.at(-1).type).toBe("error");
    expect(result.some((event) => event.type === "call" || event.type === "done")).toBe(false);
  });

  it("charges missing usage fully and stops when the shared token budget is spent", async () => {
    const allowances: number[] = [];
    const result = await events(await handleAiRequest(request(), {
      limits: { ...limits, total: 12 }, limiter: createRateLimiter(100),
      generate: async (_contents, _signal, allowance) => {
        allowances.push(allowance);
        return (async function* () { yield chunk([invalid], "STOP", false); })();
      },
    }));
    expect(allowances).toEqual([8, 4]);
    expect(result.at(-1).type).toBe("error");
  });

  it("shares recoveries with truncation and preserves only earlier visible text", async () => {
    let attempts = 0;
    const result = await events(await handleAiRequest(request(), {
      limits, limiter: createRateLimiter(100),
      generate: async () => (async function* () {
        attempts++;
        yield attempts === 1 ? chunk([{ text: "Keep this. " }], "MAX_TOKENS") : chunk([{ text: "Discard this." }, invalid]);
      })(),
    }));
    expect(attempts).toBe(3);
    expect(visibleText(result)).toBe("Keep this. ");
    expect(result.at(-1).type).toBe("error");
  });

  it("carries used repair allowance through a single-use tool checkpoint", async () => {
    let attempts = 0;
    const dependencies = {
      limits, limiter: createRateLimiter(100), budgets: createBudgetStore(),
      generate: async () => (async function* () { attempts++; yield chunk([attempts === 3 ? valid : invalid]); })(),
    };
    const first = await events(await handleAiRequest(request(), dependencies));
    expect(attempts).toBe(3);
    expect(first.at(-1).type).toBe("done");
    const continuation = { continuation: first.at(-1).continuation, toolResults: [{ id: "read", name: "read_board", result: {} }] };
    const second = await events(await handleAiRequest(request(continuation), dependencies));
    expect(attempts).toBe(4);
    expect(second.at(-1).type).toBe("error");
    expect((await handleAiRequest(request(continuation), dependencies)).status).toBe(409);
  });

  it("does not attempt repair after request cancellation", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const result = await events(await handleAiRequest(request({}, controller.signal), {
      limits, limiter: createRateLimiter(100),
      generate: async () => (async function* () { attempts++; yield chunk([invalid]); controller.abort(); })(),
    }));
    expect(attempts).toBe(1);
    expect(result.some((event) => event.type === "call" || event.type === "done")).toBe(false);
  });

  it("keeps corrected proposals behind review and preserves manual revisions", async () => {
    useWorkspace.setState({ data: createWorkspace(), view: "notes", jobId: null, selection: null, autoApplyChanges: false });
    let attempts = 0;
    let staged!: (change: PendingChange) => void;
    const pending = new Promise<PendingChange>((resolve) => { staged = resolve; });
    const args = { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "Corrected note\n" }], summary: "Record the explanation" };
    const dependencies = {
      limits, limiter: createRateLimiter(100), budgets: createBudgetStore(),
      generate: async () => (async function* () {
        attempts++;
        yield attempts < 3
          ? chunk([{ functionCall: { name: "edit_notes", args: { ...args, baseRevision: attempts === 1 ? -1 : 0 } }, thoughtSignature: "opaque-no-id" }])
          : chunk([{ text: "Your manual edit was preserved." }]);
      })(),
    };
    const client = createCollaborator({
      onError: () => {}, onPending: (change) => { if (change) staged(change); },
      runCode: async () => { throw new Error("Execution must not be requested"); },
      request: async (url, init) => handleAiRequest(new Request(new URL(String(url), "http://localhost:3000"), {
        ...init, headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      }), dependencies),
    });
    const original = useWorkspace.getState().data.notes.text;
    const job = client.ask("Add a note");
    const proposal = await pending;
    expect(attempts).toBe(2);
    expect(proposal.proposal.baseRevision).toBe(0);
    expect(useWorkspace.getState().data.notes.text).toBe(original);
    expect(useWorkspace.getState().data.changes).toHaveLength(0);
    useWorkspace.getState().setText("notes", "My newer note");
    await client.approve();
    await job;
    expect(useWorkspace.getState().data.notes.text).toBe("My newer note");
    expect(useWorkspace.getState().data.changes).toHaveLength(0);
    expect(useWorkspace.getState().data.messages.at(-1)?.status).toBe("complete");
  });
});
