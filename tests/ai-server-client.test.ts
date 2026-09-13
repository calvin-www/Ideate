import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollaborator, type PendingChange } from "../src/features/ai/useCollaborator";
import { createWorkspace, type ArtifactRef, type Run } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";

beforeEach(() => { useWorkspace.setState({ data: createWorkspace(), view: "code", selection: null, jobId: null, activity: "" }); });

function providerCall(name: string, args: Record<string, unknown>) {
  let requests = 0;
  const request: typeof fetch = async () => {
    requests++;
    const events = requests === 1 ? [
      { type: "call", id: "operation-1", name, args },
      { type: "done", continuation: { contents: [{ role: "model", parts: [{ functionCall: { id: "operation-1", name, args } }] }] } },
    ] : [{ type: "text", text: "Review recorded." }, { type: "done", continuation: { contents: [] } }];
    return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
  };
  return { request, count: () => requests };
}

function providerReadsThenNotes(reads: Array<{ name: string; args: Record<string, unknown> }>, notesRevision = 0) {
  let step = 0;
  const results: Array<{ source: ArtifactRef; text?: string }> = [];
  const request: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    for (const result of body.toolResults ?? []) if (result.name.startsWith("read_")) results.push(result.result);
    const read = reads[step];
    const call = read ? { type: "call", id: `read-${step}`, ...read } : step === reads.length ? {
      type: "call", id: "notes-link", name: "edit_notes", args: { baseRevision: notesRevision, replacements: [{ from: 0, to: 0, text: `[Read source](#source:${results.at(-1)!.source.id})\n` }], summary: "Record the exact source read" },
    } : undefined;
    step++;
    const events = call ? [call, { type: "done", continuation: { contents: [{ role: "model", parts: [{ functionCall: { id: call.id, name: call.name, args: call.args } }] }] } }] : [{ type: "text", text: "Saved the source link." }, { type: "done", continuation: { contents: [] } }];
    return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
  };
  return { request, results };
}

describe("client AI review lifecycle", () => {
  it("never overwrites a manual edit made while a proposal waits for approval", async () => {
    const provider = providerCall("edit_code", { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "# proposed\n" }], summary: "Add explanation" });
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const asking = collaborator.ask("Add a comment to my code.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    useWorkspace.getState().setText("code", "# my manual edit\n");
    await collaborator.approve();
    await asking;
    expect(useWorkspace.getState().data.code.text).toBe("# my manual edit\n");
    expect(useWorkspace.getState().data.acceptedOperations).toHaveLength(0);
  });

  it("applies an approved patch once and records its source", async () => {
    const provider = providerCall("edit_notes", { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "An insight.\n" }], summary: "Capture the insight" });
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const asking = collaborator.ask("Add this insight to my notes.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    await Promise.all([collaborator.approve(), collaborator.approve()]);
    await asking;
    const data = useWorkspace.getState().data;
    expect(data.notes.text).toMatch(/^An insight\./);
    expect(data.notes.revision).toBe(1);
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0].sources[0]).toMatchObject({ tool: "code", revision: 0 });
  });

  it("cancels pending review and prevents late application or further model rounds", async () => {
    const provider = providerCall("edit_code", { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "# proposed\n" }], summary: "Add explanation" });
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const before = useWorkspace.getState().data.code.text;
    const asking = collaborator.ask("Add a comment.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    collaborator.cancel();
    await collaborator.approve();
    await asking;
    expect(useWorkspace.getState().data.code.text).toBe(before);
    expect(useWorkspace.getState().jobId).toBeNull();
    expect(provider.count()).toBe(1);
  });

  it("does not execute a model-requested run when the student only asks for an explanation", async () => {
    const provider = providerCall("run_python", { revision: 0 });
    let runs = 0;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { runs++; return {} as Run; }, onPending: () => {}, onError: () => {} });
    await collaborator.ask("Explain my last run.");
    expect(runs).toBe(0);
    expect(provider.count()).toBe(2);
  });

  it("blocks a notes proposal when its selected Python source changes during review", async () => {
    const provider = providerCall("edit_notes", { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "Outdated insight.\n" }], summary: "Capture code insight" });
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const before = useWorkspace.getState().data.notes.text;
    const asking = collaborator.ask("Add what this code means to my notes.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    useWorkspace.getState().setText("code", "print('different source')");
    await collaborator.approve();
    await asking;
    expect(useWorkspace.getState().data.notes.text).toBe(before);
    expect(useWorkspace.getState().data.changes).toHaveLength(0);
  });

  it("can capture an immutable saved run even after the live code has changed", async () => {
    const state = useWorkspace.getState();
    state.setData((data) => ({ ...data, code: { ...data.code, revision: 1 }, runs: [{ id: "saved-run", code: "print(3)", revision: 0, output: "3\n", status: "success", startedAt: 1, durationMs: 1 }] }));
    useWorkspace.setState({ selection: { tool: "code", revision: 0, runId: "saved-run", text: "3\n" } });
    const provider = providerCall("edit_notes", { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "Run saved-run at revision 0 printed 3.\n" }], summary: "Capture the saved result" });
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const asking = collaborator.ask("Add this saved output to my notes.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    await collaborator.approve(); await asking;
    expect(useWorkspace.getState().data.notes.text).toMatch(/^Run saved-run/);
    expect(useWorkspace.getState().data.changes[0].sources[0].runId).toBe("saved-run");
  });

  it("stops only the execution owned by its cancelled AI job", async () => {
    const provider = providerCall("run_python", { revision: 0 });
    let resolveRun: ((run: Run) => void) | undefined;
    let stopped = 0;
    const run: Run = { id: "ai-run", code: "print(1)", revision: 0, output: "", status: "running", startedAt: 1, durationMs: 0 };
    const collaborator = createCollaborator({ ...provider, onPending: () => {}, onError: () => {}, runCode: () => {
      useWorkspace.getState().setData((data) => ({ ...data, runs: [...data.runs, run] }));
      return new Promise((resolve) => { resolveRun = resolve; });
    }, stopCode: () => { stopped++; resolveRun?.({ ...run, status: "cancelled" }); } });
    const asking = collaborator.ask("Run my code.");
    await vi.waitFor(() => expect(resolveRun).toBeTypeOf("function"));
    collaborator.cancel(); await asking;
    expect(stopped).toBe(1);
    expect(useWorkspace.getState().jobId).toBeNull();
  });

  it("blocks a code proposal when notes included in its initial context change", async () => {
    const provider = providerCall("edit_code", { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "# based on notes\n" }], summary: "Use the notes" });
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const before = useWorkspace.getState().data.code.text;
    const asking = collaborator.ask("Use my notes to update my code.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    useWorkspace.getState().setText("notes", "A new instruction in my notes");
    await collaborator.approve(); await asking;
    expect(useWorkspace.getState().data.code.text).toBe(before);
    expect(useWorkspace.getState().data.changes).toHaveLength(0);
  });

  it("records a reviewed source link in notes as an undoable artifact change", async () => {
    const provider = providerCall("link_artifacts", { sourceIds: ["code"], target: "notes", summary: "Connect the implementation" });
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ ...provider, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const asking = collaborator.ask("Link the Python implementation in my notes.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    await collaborator.approve(); await asking;
    const data = useWorkspace.getState().data;
    expect(data.notes.text).toContain("#source:");
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0].target).toBe("notes");
    const reference = data.references.find((ref) => data.notes.text.includes(`#source:${ref.id}`));
    expect(reference).toMatchObject({ tool: "code", revision: 0 });
  });

  it("keeps the initial context immutable when a later read adds a run reference", async () => {
    useWorkspace.getState().setData((data) => ({ ...data, runs: [{ id: "saved-run", code: "print(1)", revision: 0, output: "1\n", status: "success", startedAt: 1, durationMs: 1 }] }));
    const provider = providerCall("read_run", { id: "saved-run" });
    const contexts: unknown[] = [];
    const collaborator = createCollaborator({ request: async (input, init) => {
      contexts.push(JSON.parse(String(init?.body)).context);
      return provider.request(input, init);
    }, runCode: async () => { throw new Error("unexpected run"); }, onPending: () => {}, onError: () => {} });
    await collaborator.ask("Explain the saved result.");
    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toEqual(contexts[0]);
    expect(useWorkspace.getState().data.messages.at(-1)?.sources?.some((ref) => ref.runId === "saved-run")).toBe(true);
  });

  it.each([
    { status: 413, message: "This context is too large. Try a smaller selection.", streamed: false },
    { status: 502, message: "Gemini could not finish this request. Your workspace is safe; please try again.", streamed: false },
    { status: 200, message: "The answer reached its length limit. Try a smaller step.", streamed: true },
  ])("shows the safe endpoint reason for $message", async ({ status, message, streamed }) => {
    let shown = "";
    const event = { type: "error", message };
    const collaborator = createCollaborator({ request: async () => new Response(JSON.stringify(event) + (streamed ? "\n" : ""), { status, headers: { "Content-Type": streamed ? "application/x-ndjson" : "application/json" } }), runCode: async () => { throw new Error("unexpected run"); }, onPending: () => {}, onError: (value) => { shown = value; } });
    await collaborator.ask("Explain my code.");
    expect(shown).toBe(message);
    expect(useWorkspace.getState().data.messages.at(-1)?.text).toBe(message);
  });

  it.each(["code", "notes"] as const)("saves the exact %s range read beyond the initial source excerpt", async (tool) => {
    useWorkspace.getState().setText(tool, "x".repeat(3_000) + "return target\nreturn target\n");
    const provider = providerReadsThenNotes([
      { name: `read_${tool}`, args: { from: 3_000, to: 3_014 } },
      { name: `read_${tool}`, args: { from: 3_014, to: 3_028 } },
      { name: `read_${tool}`, args: { from: 3_014, to: 3_028 } },
    ], tool === "notes" ? 1 : 0);
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ request: provider.request, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const asking = collaborator.ask("Read the requested section and link it in my notes.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    await collaborator.approve(); await asking;
    expect(provider.results[0].source).toMatchObject({ tool, revision: 1, from: 3_000, to: 3_014, excerpt: "return target\n" });
    const source = provider.results[1].source;
    expect(source).toMatchObject({ tool, revision: 1, from: 3_014, to: 3_028, excerpt: "return target\n" });
    expect(provider.results[0].source.id).not.toBe(source.id);
    expect(provider.results[2].source.id).toBe(source.id);
    const data = useWorkspace.getState().data;
    expect(data.notes.text).toContain(`#source:${source.id}`);
    expect(data.references.find((ref) => ref.id === source.id)).toEqual(source);
    expect(data.messages.at(-1)?.sources?.find((ref) => ref.id === source.id)).toEqual(source);
  });

  it("keeps distinct board subset reads at one revision as distinct saved sources", async () => {
    useWorkspace.getState().setBoard([
      { id: "left", type: "text", x: 0, y: 0, width: 100, height: 20, text: "Shared label" },
      { id: "right", type: "text", x: 200, y: 0, width: 100, height: 20, text: "Shared label" },
    ]);
    const provider = providerReadsThenNotes([{ name: "read_board", args: { ids: ["left"] } }, { name: "read_board", args: { ids: ["right"] } }]);
    let pending: PendingChange | null = null;
    const collaborator = createCollaborator({ request: provider.request, runCode: async () => { throw new Error("unexpected run"); }, onPending: (value) => { pending = value; }, onError: () => {} });
    const asking = collaborator.ask("Read both diagram subsets and link the second one.");
    await vi.waitFor(() => expect(pending).not.toBeNull());
    await collaborator.approve(); await asking;
    expect(provider.results[0].source).toMatchObject({ ids: ["left"], excerpt: "Shared label", revision: 1 });
    expect(provider.results[1].source).toMatchObject({ ids: ["right"], excerpt: "Shared label", revision: 1 });
    expect(provider.results[0].source.id).not.toBe(provider.results[1].source.id);
    const source = provider.results[1].source;
    const data = useWorkspace.getState().data;
    expect(data.notes.text).toContain(`#source:${source.id}`);
    expect(data.references.find((ref) => ref.id === source.id)).toEqual(source);
  });

  it.each([
    "Explain why it hangs when I run it",
    "Test my understanding of binary search",
    "Run through the algorithm with me",
    "Can you explain how to run my code?",
    "Explain what 'implement and run it' means",
  ])("does not treat an execution mention as authorization: %s", async (prompt) => {
    const provider = providerCall("run_python", { revision: 0 });
    let runs = 0;
    const collaborator = createCollaborator({ request: provider.request, runCode: async () => { runs++; return {} as Run; }, onPending: () => {}, onError: () => {} });
    await collaborator.ask(prompt);
    expect(runs).toBe(0);
  });

  it.each(["Run my code", "Implement binary search and run it", "Can you execute this code?"])("executes a directly requested program: %s", async (prompt) => {
    const provider = providerCall("run_python", { revision: 0 });
    let runs = 0;
    const collaborator = createCollaborator({ request: provider.request, runCode: async () => { runs++; return { id: "actual-run", revision: 0, code: "print(1)", output: "1\n", status: "success", startedAt: 1, durationMs: 1 }; }, onPending: () => {}, onError: () => {} });
    await collaborator.ask(prompt);
    expect(runs).toBe(1);
    expect(useWorkspace.getState().data.messages.at(-1)?.sources?.find((source) => source.runId === "actual-run")).toMatchObject({ revision: 0, excerpt: "1\n", from: 0, to: 2 });
  });
});
