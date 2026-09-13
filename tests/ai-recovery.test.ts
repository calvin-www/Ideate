import { describe, expect, it } from "vitest";
import type { Content, GenerateContentResponse } from "@google/genai";
import { handleAiRequest } from "../src/features/ai/server/handler";
import { createRateLimiter } from "../src/features/ai/server/validation";
import { createBudgetStore } from "../src/features/ai/server/budget";

const initial = {
  messages: [{ role: "user", text: "Help with my code" }],
  context: {},
};
const request = (extra = {}) =>
  new Request("http://localhost:3000/api/ai", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...initial, ...extra }),
  });
const limits = { recoveries: 2 };
const limiter = createRateLimiter(1000);
const responseChunk = (
  parts: unknown[],
  finishReason = "STOP",
  usageMetadata?: unknown,
) =>
  ({
    candidates: [{ content: { role: "model", parts }, finishReason }],
    usageMetadata,
  }) as GenerateContentResponse;
const events = async (response: Response) =>
  (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
const textOf = (items: Array<{ type: string; text?: string }>) =>
  items.reduce(
    (text, item) =>
      item.type === "text"
        ? text + item.text
        : item.type === "replace"
          ? item.text!
          : text,
    "",
  );

describe("bounded AI recovery", () => {
  it("never releases tools from a stream missing its completion reason", async () => {
    const result = await events(
      await handleAiRequest(request(), {
        limits,
        limiter,
        generate: async () =>
          (async function* () {
            yield {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ functionCall: { name: "read_code", args: {} } }],
                  },
                },
              ],
            } as GenerateContentResponse;
          })(),
      }),
    );
    expect(
      result.some((event) => event.type === "call" || event.type === "done"),
    ).toBe(false);
    expect(result.at(-1).type).toBe("error");
  });
  it("recovers twice by default before pausing", async () => {
    let calls = 0;
    const result = await events(
      await handleAiRequest(request(), {
        limiter,
        generate: async () =>
          (async function* () {
            calls++;
            yield responseChunk([], "MAX_TOKENS");
          })(),
      }),
    );
    expect(calls).toBe(3);
    expect(result.at(-1).type).toBe("paused");
  });

  it("continues partial text in the same response and preserves provider signatures", async () => {
    const inputs: Content[][] = [];
    const partial = { text: "First part. ", thoughtSignature: "opaque" };
    const result = await events(
      await handleAiRequest(request(), {
        limits,
        limiter,
        generate: async (contents) => {
          inputs.push(structuredClone(contents));
          return (async function* () {
            yield inputs.length === 1
              ? responseChunk([partial], "MAX_TOKENS")
              : responseChunk([{ text: "Second part." }], "STOP", {
                  candidatesTokenCount: 3,
                  thoughtsTokenCount: 2,
                });
          })();
        },
      }),
    );
    expect(textOf(result)).toBe("First part. Second part.");
    expect(result.at(-1).type).toBe("done");
    expect(result.some((event) => event.type === "status")).toBe(true);
    expect(inputs[1].at(-2)?.parts).toEqual([partial]);
    expect(inputs).toHaveLength(2);
  });

  it("retries an empty cutoff", async () => {
    let calls = 0;
    const inputs: Content[][] = [];
    const result = await events(
      await handleAiRequest(request(), {
        limits,
        limiter,
        generate: async (contents) => {
          inputs.push(structuredClone(contents));
          calls++;
          return (async function* () {
            yield responseChunk(
              calls === 1 ? [] : [{ text: "Recovered" }],
              calls === 1 ? "MAX_TOKENS" : "STOP",
            );
          })();
        },
      }),
    );
    expect(calls).toBe(2);
    expect(inputs[1]).toEqual(inputs[0]);
    expect(result.at(-1).type).toBe("done");
    expect(textOf(result)).toBe("Recovered");
  });

  it("discards a truncated tool attempt without emitting or replaying its operations", async () => {
    let calls = 0;
    const inputs: Content[][] = [];
    const result = await events(
      await handleAiRequest(request(), {
        limits,
        limiter,
        generate: async (contents) => {
          inputs.push(structuredClone(contents));
          calls++;
          return (async function* () {
            yield calls === 1
              ? responseChunk(
                  [
                    { text: "Discard this attempt" },
                    {
                      functionCall: {
                        name: "edit_code",
                        args: { baseRevision: 0 },
                      },
                    },
                  ],
                  "MAX_TOKENS",
                )
              : responseChunk([
                  { text: "Let me read first." },
                  {
                    functionCall: { name: "read_code", args: {} },
                    thoughtSignature: "valid",
                  },
                ]);
          })();
        },
      }),
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toEqual(inputs[0]);
    expect(textOf(result)).toBe("Let me read first.");
    expect(
      result
        .filter((event) => event.type === "call")
        .map((event) => event.name),
    ).toEqual(["read_code"]);
  });

  it("rejects a replayed tool checkpoint across rounds", async () => {
    let calls = 0;
    const dependencies = {
      limits,
      limiter,
      generate: async () => {
        calls++;
        return (async function* () {
          yield responseChunk(
            [{ functionCall: { id: "read", name: "read_code", args: {} } }],
            "STOP",
            { candidatesTokenCount: 2, thoughtsTokenCount: 8 },
          );
        })();
      },
    };
    const first = await events(await handleAiRequest(request(), dependencies));
    const secondBody = {
      continuation: first.at(-1).continuation,
      toolResults: [{ id: "read", name: "read_code", result: {} }],
    };
    const second = await events(
      await handleAiRequest(request(secondBody), dependencies),
    );
    await events(
      await handleAiRequest(
        request({ ...secondBody, continuation: second.at(-1).continuation }),
        dependencies,
      ),
    );
    expect(calls).toBe(3);
    const replay = await handleAiRequest(request(secondBody), dependencies);
    expect(replay.status).toBe(409);
    expect(calls).toBe(3);
  });

  it("pauses after exhausted recoveries, and only an explicit resume grants fresh ones", async () => {
    let calls = 0;
    const dependencies = {
      limits,
      limiter,
      generate: async () => {
        calls++;
        return (async function* () {
          yield responseChunk(
            [{ text: calls < 4 ? "Partial. " : "Finished." }],
            calls < 4 ? "MAX_TOKENS" : "STOP",
          );
        })();
      },
    };
    const first = await events(await handleAiRequest(request(), dependencies));
    expect(calls).toBe(3);
    expect(first.at(-1)).toMatchObject({
      type: "paused",
      resume: { token: expect.any(String), append: true },
    });
    expect(first.some((event) => event.type === "error")).toBe(false);
    const resumed = await events(
      await handleAiRequest(
        request({ resume: first.at(-1).resume }),
        dependencies,
      ),
    );
    expect(resumed.at(-1).type).toBe("done");
    expect(calls).toBe(4);
    expect(
      (
        await handleAiRequest(
          request({ resume: first.at(-1).resume }),
          dependencies,
        )
      ).status,
    ).toBe(409);
  });

  it("pauses after eight tool rounds without replaying completed operations on resume", async () => {
    const inputs: Content[][] = [];
    const dependencies = {
      limits,
      limiter,
      generate: async (contents: Content[]) => {
        inputs.push(structuredClone(contents));
        return (async function* () {
          yield inputs.length <= 8
            ? responseChunk([
                {
                  functionCall: {
                    id: `read-${inputs.length}`,
                    name: "read_code",
                    args: {},
                  },
                },
              ])
            : responseChunk([{ text: "Explained the saved results." }]);
        })();
      },
    };
    let result = await events(await handleAiRequest(request(), dependencies));
    for (let round = 1; round <= 8; round++) {
      result = await events(
        await handleAiRequest(
          request({
            continuation: result.at(-1).continuation,
            toolResults: [
              {
                id: `read-${round}`,
                name: "read_code",
                result: { text: `result-${round}` },
              },
            ],
          }),
          dependencies,
        ),
      );
    }
    expect(inputs).toHaveLength(8);
    expect(result.at(-1).type).toBe("paused");
    const resumed = await events(
      await handleAiRequest(
        request({ resume: result.at(-1).resume }),
        dependencies,
      ),
    );
    expect(inputs).toHaveLength(9);
    expect(inputs[8].at(-1)?.parts?.[0].functionResponse?.response).toEqual({
      output: { text: "result-8" },
    });
    expect(resumed.filter((event) => event.type === "call")).toEqual([]);
    expect(resumed.at(-1).type).toBe("done");
  });

  it("rejects missing, tampered, and expired budget checkpoints before contacting Gemini", async () => {
    let now = 0,
      calls = 0;
    const budgets = createBudgetStore(() => now);
    const dependencies = {
      limits,
      limiter,
      budgets,
      generate: async () =>
        (async function* () {
          calls++;
          yield responseChunk([
            { functionCall: { id: "read", name: "read_code", args: {} } },
          ]);
        })(),
    };
    const result = await events(await handleAiRequest(request(), dependencies));
    const continuation = result.at(-1).continuation;
    const toolResults = [{ id: "read", name: "read_code", result: {} }];
    expect(
      (
        await handleAiRequest(
          request({
            continuation: { contents: continuation.contents },
            toolResults,
          }),
          dependencies,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handleAiRequest(
          request({ continuation, toolResults, context: { changed: true } }),
          dependencies,
        )
      ).status,
    ).toBe(409);
    const altered = structuredClone(continuation);
    altered.contents[0].parts[0].text = "Changed prompt";
    expect(
      (
        await handleAiRequest(
          request({ continuation: altered, toolResults }),
          dependencies,
        )
      ).status,
    ).toBe(409);
    now = 31 * 60_000;
    expect(
      (
        await handleAiRequest(
          request({ continuation, toolResults }),
          dependencies,
        )
      ).status,
    ).toBe(409);
    expect(calls).toBe(1);
  });

  it("stops after two recoveries", async () => {
    let calls = 0;
    const result = await events(
      await handleAiRequest(request(), {
        limits,
        limiter,
        generate: async () =>
          (async function* () {
            calls++;
            yield responseChunk([{ text: "More " }], "MAX_TOKENS");
          })(),
      }),
    );
    expect(calls).toBe(3);
    expect(result.at(-1).type).toBe("paused");
  });

  it("does not recover safety failures or retry after cancellation", async () => {
    let calls = 0;
    const result = await events(
      await handleAiRequest(request(), {
        limits,
        limiter,
        generate: async () =>
          (async function* () {
            calls++;
            yield responseChunk([], "SAFETY");
          })(),
      }),
    );
    expect(calls).toBe(1);
    expect(result.at(-1).type).toBe("error");
    const controller = new AbortController();
    await events(
      await handleAiRequest(
        new Request(request(), { signal: controller.signal }),
        {
          limits,
          limiter,
          generate: async () =>
            (async function* () {
              calls++;
              yield responseChunk([{ text: "Partial" }], "MAX_TOKENS");
              controller.abort();
            })(),
        },
      ),
    );
    expect(calls).toBe(2);
  });
});
