import { beforeEach, expect, it, vi } from "vitest";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";
import { useProviderKeys } from "../src/features/settings/providerKeys";

const checkpoint = { token: "single-use", state: "opaque-sdk-state" };

function response(chunks: UIMessageChunk[]) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute({ writer }) {
        writer.write({ type: "start" });
        writer.write({ type: "text-start", id: "answer" });
        for (const chunk of chunks) writer.write(chunk);
        writer.write({ type: "text-end", id: "answer" });
        writer.write({ type: "finish" });
      },
    }),
  });
}

beforeEach(() => {
  useWorkspace.setState({
    data: createWorkspace(),
    view: "code",
    selection: null,
    jobId: null,
    activity: "",
    autoApplyChanges: true,
  });
  useProviderKeys.setState({
    keys: { gemini: "browser-key", elevenLabsKey: "", elevenLabsVoiceId: "" },
  });
});

it("uses the UI stream for a paused answer and sends an opaque Continue checkpoint", async () => {
  const bodies: unknown[] = [];
  const headers: HeadersInit[] = [];
  const onPause = vi.fn();
  const onError = vi.fn();
  const collaborator = createCollaborator({
    onPause,
    onError,
    onPending: vi.fn(),
    runCode: vi.fn(),
    request: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      headers.push(init?.headers ?? {});
      return bodies.length === 1
        ? response([
            { type: "text-delta", id: "answer", delta: "First part. " },
            { type: "data-paused", data: { message: "Paused", checkpoint, append: true }, transient: true },
          ])
        : response([
            { type: "text-delta", id: "answer", delta: "Second part." },
            { type: "data-done", data: {}, transient: true },
          ]);
    },
  });

  await collaborator.ask("Explain this code");
  expect(onPause).toHaveBeenCalledWith("Paused");
  expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
    text: "First part. ", status: "paused",
  });
  await collaborator.resume();

  expect(bodies[0]).toMatchObject({ type: "start", messages: [{ role: "user", text: "Explain this code" }] });
  expect(bodies[1]).toEqual({ type: "continue", checkpoint });
  expect(new Headers(headers[0]).get("x-gemini-key")).toBe("browser-key");
  expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
    text: "First part. Second part.", status: "complete",
  });
  expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/invalid|failed/i));
});

it("submits validated operation results after the whole UI batch arrives", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const collaborator = createCollaborator({
    onError: vi.fn(),
    onPending: vi.fn(),
    runCode: vi.fn(),
    request: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? response([
            { type: "text-delta", id: "answer", delta: "Reading." },
            {
              type: "data-operationBatch",
              data: { operations: [{ id: "read-1", operation: { name: "read_code", args: {} } }], checkpoint },
              transient: true,
            },
          ])
        : response([
            { type: "text-delta", id: "answer", delta: "The file is empty." },
            { type: "data-done", data: {}, transient: true },
          ]);
    },
  });

  await collaborator.ask("Read my code");

  expect(bodies[1]).toMatchObject({
    type: "results",
    checkpoint,
    results: [{ id: "read-1", result: { text: "" } }],
  });
  expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
    text: "Reading.\n\nThe file is empty.", status: "complete",
  });
});

it("does not dispatch a batch containing an invalid sibling operation", async () => {
  const onError = vi.fn();
  const collaborator = createCollaborator({
    onError,
    onPending: vi.fn(),
    runCode: vi.fn(),
    request: async () => response([{
      type: "data-operationBatch",
      data: {
        operations: [
          { id: "valid", operation: { name: "edit_code", args: { baseRevision: 0, replacements: [{ from: 0, to: 0, text: "wrong" }], summary: "Add code" } } },
          { id: "invalid", operation: { name: "edit_code", args: { baseRevision: -1 } } },
        ],
        checkpoint,
      },
      transient: true,
    }]),
  });

  await collaborator.ask("Edit my code");

  expect(useWorkspace.getState().data.code.text).toBe("");
  expect(useWorkspace.getState().data.changes).toEqual([]);
  expect(onError).toHaveBeenCalledWith(expect.stringMatching(/invalid operation/i));
});
