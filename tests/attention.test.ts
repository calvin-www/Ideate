import { beforeEach, expect, it, vi } from "vitest";
import { validateToolCall } from "../src/features/ai/server/tools";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";

beforeEach(() => {
  useWorkspace.setState({
    data: createWorkspace(),
    view: "code",
    visibleTools: ["code"],
    selection: null,
    jobId: null,
  });
});

const codeCue = {
  target: "code",
  revision: 0,
  from: 2,
  to: 15,
  mode: "highlight",
  label: "The search bounds",
};

function provider(name: string, args: Record<string, unknown>) {
  const results: unknown[] = [];
  const request: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.toolResults) results.push(body.toolResults[0].result);
    const call = { id: "cue-call", name, args };
    const events = body.toolResults
      ? [
          { type: "text", text: "Look at the marked part." },
          { type: "done", continuation: { contents: [] } },
        ]
      : [
          { type: "call", ...call },
          {
            type: "done",
            continuation: {
              contents: [{ role: "model", parts: [{ functionCall: call }] }],
            },
          },
        ];
    return new Response(
      events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    );
  };
  const pending = vi.fn();
  const collaborator = createCollaborator({
    request,
    onPending: pending,
    onError: vi.fn(),
    runCode: vi.fn(),
  });
  return { collaborator, results, pending };
}

it("does not report a source cue as visible when only its output is focused", async () => {
  useWorkspace.setState({ view: "code", visibleTools: [] });
  const fixture = provider("show_attention", codeCue);
  await fixture.collaborator.ask("Point out the search bounds");
  expect(fixture.results).toEqual([
    expect.objectContaining({ status: "shown", visible: false }),
  ]);
});

it("validates semantic targets and rejects malformed or empty highlights", () => {
  expect(validateToolCall("show_attention", codeCue)).toEqual(codeCue);
  expect(
    validateToolCall("show_attention", { ...codeCue, to: 1 }),
  ).toBeUndefined();
  expect(
    validateToolCall("show_attention", { ...codeCue, to: 2 }),
  ).toBeUndefined();
  expect(
    validateToolCall("show_attention", { ...codeCue, mode: "point", to: 2 }),
  ).toBeDefined();
  expect(
    validateToolCall("show_attention", {
      ...codeCue,
      target: "board",
      ids: ["a"],
    }),
  ).toBeUndefined();
  expect(
    validateToolCall("show_attention", {
      target: "board",
      revision: 0,
      ids: [],
      mode: "point",
      label: "Here",
    }),
  ).toBeUndefined();
});

it("shows a cue without changing documents, selection, navigation, or staging an edit", async () => {
  const before = useWorkspace.getState().data;
  const selection = {
    tool: "notes" as const,
    revision: 0,
    from: 0,
    to: 3,
    text: before.notes.text.slice(0, 3),
  };
  useWorkspace.setState({ selection, view: "notes", visibleTools: ["notes"] });
  const fixture = provider("show_attention", codeCue);
  await fixture.collaborator.ask("Point out the search bounds");
  expect(fixture.results).toEqual([
    expect.objectContaining({ status: "shown", visible: false }),
  ]);
  expect(useWorkspace.getState().attention.code).toMatchObject(codeCue);
  expect(useWorkspace.getState().selection).toEqual(selection);
  expect(useWorkspace.getState().view).toBe("notes");
  for (const key of ["code", "notes", "board", "changes"] as const)
    expect(useWorkspace.getState().data[key]).toEqual(before[key]);
  expect(fixture.pending.mock.calls.every(([value]) => value === null)).toBe(
    true,
  );
});

it.each([
  [{ ...codeCue, revision: 7 }, "conflicted"],
  [{ ...codeCue, to: 900_000 }, "not_found"],
  [
    {
      target: "board",
      revision: 0,
      ids: ["missing"],
      mode: "point",
      label: "Here",
    },
    "not_found",
  ],
])(
  "rejects unavailable targets without leaving a cue (%j)",
  async (args, status) => {
    const fixture = provider("show_attention", args);
    await fixture.collaborator.ask("Show me");
    expect(fixture.results).toEqual([expect.objectContaining({ status })]);
    expect(useWorkspace.getState().attention).toEqual({});
  },
);

it("invalidates a cue on editing and does not resurrect it after undo or workspace replacement", async () => {
  const before = useWorkspace.getState().data;
  await provider("show_attention", codeCue).collaborator.ask("Show me");
  useWorkspace.getState().setText("code", "# changed");
  expect(useWorkspace.getState().attention).toEqual({});
  useWorkspace.setState({ data: before });
  expect(useWorkspace.getState().attention).toEqual({});
  await provider("show_attention", codeCue).collaborator.ask("Show me again");
  useWorkspace.setState({ data: createWorkspace() });
  expect(useWorkspace.getState().attention).toEqual({});
});

it("allows the partner to clear its cues", async () => {
  await provider("show_attention", codeCue).collaborator.ask("Show me");
  const fixture = provider("clear_attention", {});
  await fixture.collaborator.ask("Clear the highlighting");
  expect(fixture.results).toEqual([
    expect.objectContaining({ status: "cleared" }),
  ]);
  expect(useWorkspace.getState().attention).toEqual({});
});

it("clears cues on importing changed content even when its ID and revision were reused", async () => {
  await provider("show_attention", codeCue).collaborator.ask("Show me");
  const current = useWorkspace.getState().data;
  useWorkspace.setState({
    data: {
      ...current,
      code: { ...current.code, text: "# a completely different document" },
    },
  });
  expect(useWorkspace.getState().attention).toEqual({});
});

it("cancellation clears cues and ignores a late provider completion", async () => {
  // Capture a real tool turn, then hold the explanation after its cue was shown.
  let finish: (response: Response) => void = () => {};
  let round = 0;
  const request: typeof fetch = async () => {
    if (round++ > 0)
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    const call = { id: "held-cue", name: "show_attention", args: codeCue };
    return new Response(
      [
        { type: "call", ...call },
        {
          type: "done",
          continuation: {
            contents: [{ role: "model", parts: [{ functionCall: call }] }],
          },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n",
    );
  };
  const collaborator = createCollaborator({
    request,
    runCode: vi.fn(),
    onPending: vi.fn(),
    onError: vi.fn(),
  });
  const asking = collaborator.ask("Show me");
  await vi.waitFor(() => expect(round).toBe(2));
  expect(useWorkspace.getState().attention.code).toBeDefined();
  collaborator.cancel();
  finish(
    new Response(
      JSON.stringify({ type: "done", continuation: { contents: [] } }) + "\n",
    ),
  );
  await asking;
  expect(useWorkspace.getState().attention).toEqual({});
  expect(useWorkspace.getState().data.messages.at(-1)?.status).toBe(
    "cancelled",
  );
});
