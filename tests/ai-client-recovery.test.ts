import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";
import { validateImport } from "../src/features/workspace/model";
import { uiResponse } from "./ai-client-fixture";

beforeEach(() =>
  useWorkspace.setState({
    data: createWorkspace(),
    view: "code",
    selection: null,
    jobId: null,
    activity: "",
    autoApplyChanges: false,
  }),
);
const checkpoint = { token: "opaque-checkpoint", state: "fixture-state" };
const stream = uiResponse;

describe("AI recovery client", () => {
  it("keeps long continued answers within the persisted message size limit", async () => {
    let calls = 0;
    const first = "a".repeat(150_000),
      second = "b".repeat(100_000);
    const client = createCollaborator({
      onPause: vi.fn(),
      onError: vi.fn(),
      onPending: vi.fn(),
      runCode: vi.fn(),
      request: async () =>
        ++calls === 1
          ? stream([
              { type: "text", text: first },
              { type: "paused", message: "Paused", checkpoint, append: true },
            ])
          : stream([
              { type: "text", text: second },
              { type: "text", text: " done" },
              { type: "done" },
            ]),
    });
    await client.ask("Explain");
    await client.resume();
    const data = useWorkspace.getState().data;
    expect(() => validateImport(data)).not.toThrow();
    expect(
      data.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.text)
        .join(""),
    ).toBe(first + second + " done");
  });
  it("keeps one message and waits for explicit Continue before resuming", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const onPause = vi.fn(),
      onError = vi.fn();
    const client = createCollaborator({
      onPause,
      onError,
      onPending: vi.fn(),
      runCode: vi.fn(),
      request: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? stream([
              { type: "text", text: "First part. " },
              { type: "status", message: "Continuing…" },
              { type: "paused", message: "Paused at the limit.", checkpoint, append: true },
            ])
          : stream([
              { type: "text", text: "Second part." },
              { type: "done" },
            ]);
      },
    });
    await client.ask("Explain");
    expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
      text: "First part. ",
      status: "paused",
    });
    expect(useWorkspace.getState().jobId).toBeNull();
    expect(bodies).toHaveLength(1);
    expect(onPause).toHaveBeenLastCalledWith("Paused at the limit.");
    await client.resume();
    expect(bodies[1]).toEqual({
      type: "continue",
      checkpoint,
    });
    expect(useWorkspace.getState().data.messages).toHaveLength(2);
    expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
      text: "First part. Second part.",
      status: "complete",
    });
    expect(onError).not.toHaveBeenCalledWith(
      expect.stringMatching(/invalid|failed/i),
    );
    await client.resume();
    expect(bodies).toHaveLength(2);
  });

  it("replaces only the unfinished generation, preserving prior tool-round text", async () => {
    let calls = 0;
    const client = createCollaborator({
      onError: vi.fn(),
      onPending: vi.fn(),
      runCode: vi.fn(),
      request: async () =>
        ++calls === 1
          ? stream([
              { type: "text", text: "Reading your code." },
              { type: "call", id: "read", name: "read_code", args: {} },
              { type: "done" },
            ])
          : stream([
              { type: "text", text: "Discard this" },
              { type: "replace", text: "" },
              { type: "status", message: "Continuing…" },
              { type: "text", text: "Final explanation" },
              { type: "done" },
            ]),
    });
    await client.ask("Explain my code");
    expect(useWorkspace.getState().data.messages.at(-1)?.text).toBe(
      "Reading your code.\n\nFinal explanation",
    );
  });

  it.each(["clear", "edit", "cancel"])(
    "rejects a paused continuation after %s",
    async (action) => {
      let calls = 0;
      const client = createCollaborator({
        onPause: vi.fn(),
        onError: vi.fn(),
        onPending: vi.fn(),
        runCode: vi.fn(),
        request: async () => {
          calls++;
          return stream([{ type: "paused", message: "Paused", checkpoint, append: true }]);
        },
      });
      await client.ask("Explain");
      expect(useWorkspace.getState().data.messages.at(-1)?.status).toBe(
        "paused",
      );
      if (action === "clear") client.clearHistory();
      if (action === "cancel") client.cancel();
      if (action === "edit")
        useWorkspace.getState().setText("code", "# changed");
      await client.resume();
      expect(calls).toBe(1);
      if (action === "clear")
        expect(useWorkspace.getState().data.messages).toEqual([]);
    },
  );
});
