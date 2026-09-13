import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { generateStream } from "../src/features/ai/server/provider";
import { handleAiRequest } from "../src/features/ai/server/handler";
import { createRateLimiter } from "../src/features/ai/server/validation";
import { createCollaborator } from "../src/features/ai/useCollaborator";
import { createWorkspace } from "../src/features/workspace/model";
import { useWorkspace } from "../src/features/workspace/store";

beforeEach(() =>
  useWorkspace.setState({
    data: createWorkspace(),
    view: "code",
    selection: null,
    jobId: null,
    activity: "",
    autoApplyChanges: true,
  }),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AI budget integration", () => {
  it("does not cap Gemini output tokens through the actual SDK", async () => {
    vi.stubEnv("GEMINI_API_KEY", "fixture-key");
    let payload: { generationConfig: { maxOutputTokens?: number } } | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      payload = JSON.parse(String(init.body));
      return new Response(
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    const stream = await generateStream(
      [{ role: "user", parts: [{ text: "Hello" }] }],
      new AbortController().signal,
    );
    for await (const _chunk of stream) {
      /* consume the real SDK's parser */
    }
    expect(payload?.generationConfig.maxOutputTokens).toBeUndefined();
  });

  it("preserves an applied edit through exhausted recoveries and explicit Continue", async () => {
    let generations = 0;
    const onError = vi.fn();
    const client = createCollaborator({
      onError,
      onPause: vi.fn(),
      onPending: vi.fn(),
      runCode: vi.fn(),
      request: async (url, init) =>
        handleAiRequest(
          new Request(new URL(String(url), "http://localhost:3000"), {
            ...init,
            headers: {
              "Content-Type": "application/json",
              origin: "http://localhost:3000",
            },
          }),
          {
            limiter: createRateLimiter(100),
            limits: { recoveries: 2 },
            generate: async () =>
              (async function* () {
                generations++;
                yield {
                  candidates: [
                    {
                      content: {
                        role: "model",
                        parts:
                          generations === 1
                            ? [
                                {
                                  functionCall: {
                                    id: "edit-once",
                                    name: "edit_notes",
                                    args: {
                                      baseRevision: 0,
                                      replacements: [
                                        {
                                          from: 0,
                                          to: 0,
                                          text: "Saved once.\n",
                                        },
                                      ],
                                      summary: "Save a note",
                                    },
                                  },
                                  thoughtSignature: "opaque-signature",
                                },
                              ]
                            : [
                                {
                                  text:
                                    generations === 2
                                      ? "An "
                                      : generations === 3
                                        ? "unfinished "
                                        : generations === 4
                                          ? ""
                                          : "explanation.",
                                },
                              ],
                      },
                      finishReason:
                        generations >= 2 && generations <= 4
                          ? "MAX_TOKENS"
                          : "STOP",
                    },
                  ],
                } as GenerateContentResponse;
              })(),
          },
        ),
    });
    await client.ask("Add a note and explain");
    expect(generations).toBe(4);
    expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
      status: "paused",
      text: "An unfinished ",
    });
    expect(useWorkspace.getState().data.changes).toHaveLength(1);
    const notes = useWorkspace.getState().data.notes.text;
    await client.resume();
    expect(generations).toBe(5);
    expect(useWorkspace.getState().data.messages.at(-1)).toMatchObject({
      status: "complete",
      text: "An unfinished explanation.",
    });
    expect(useWorkspace.getState().data.notes.text).toBe(notes);
    expect(useWorkspace.getState().data.changes).toHaveLength(1);
    expect(onError.mock.calls.filter(([message]) => message)).toEqual([]);
  });
});
