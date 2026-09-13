import { describe, expect, it } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { handleAiRequest } from "../src/features/ai/server/handler";
import { validateToolCall } from "../src/features/ai/server/tools";
import { createRateLimiter } from "../src/features/ai/server/validation";

const request = () =>
  new Request("http://localhost:3000/api/ai", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", text: "Read my code" }],
      context: {},
    }),
  });
const chunk = (value: unknown) => value as GenerateContentResponse;

describe("AI streaming endpoint", () => {
  it("streams visible text, preserves signatures, and emits validated tool calls", async () => {
    const response = await handleAiRequest(request(), {
      generate: async () =>
        (async function* () {
          yield chunk({
            candidates: [
              { content: { role: "model", parts: [{ text: "I will read " }] } },
            ],
          });
          yield chunk({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "your code." },
                    { text: "private thought", thought: true },
                    {
                      functionCall: { name: "read_code", args: {} },
                      thoughtSignature: "opaque",
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          });
        })(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      events
        .filter((event) => event.type === "text")
        .map((event) => event.text)
        .join(""),
    ).toBe("I will read your code.");
    expect(events.find((event) => event.type === "call")).toMatchObject({
      id: expect.any(String),
      name: "read_code",
      args: {},
    });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      continuation: { contents: expect.any(Array) },
    });
    expect(
      events.at(-1).continuation.contents.at(-1).parts.at(-1).thoughtSignature,
    ).toBe("opaque");
  });

  it("maps an initial provider failure to a safe HTTP error", async () => {
    let attempts = 0;
    const response = await handleAiRequest(request(), {
      generate: async () => {
        attempts++;
        throw { status: 429, message: "secret-key" };
      },
    });
    expect(response.status).toBe(429);
    const data = await response.json();
    expect(data.type).toBe("error");
    expect(data.message).not.toContain("secret-key");
    expect(attempts).toBe(1);
  });

  it("retries a transient 503 once before producing the first response chunk", async () => {
    let attempts = 0;
    const response = await handleAiRequest(request(), {
      generate: async () => {
        attempts++;
        if (attempts === 1)
          throw { status: 503, message: "private provider details" };
        return (async function* () {
          yield chunk({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Recovered answer" }],
                },
                finishReason: "STOP",
              },
            ],
          });
        })();
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Recovered answer");
    expect(attempts).toBe(2);
  });

  it("stops after one retry when the provider remains unavailable", async () => {
    let attempts = 0;
    const response = await handleAiRequest(request(), {
      generate: async () => {
        attempts++;
        throw { status: 503, message: "private provider details" };
      },
    });
    expect(response.status).toBe(502);
    expect(attempts).toBe(2);
    expect(await response.text()).not.toContain("private provider details");
  });

  it("cancels a transient-error delay without starting another provider request", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const response = await handleAiRequest(
      new Request(request(), { signal: controller.signal }),
      {
        generate: async () => {
          attempts++;
          setTimeout(() => controller.abort(), 10);
          throw { status: 503 };
        },
      },
    );
    expect(response.status).toBe(499);
    expect(attempts).toBe(1);
  });

  it("rejects invalid generated writes and never emits a proposal for them", async () => {
    const response = await handleAiRequest(request(), {
      generate: async () =>
        (async function* () {
          yield chunk({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "edit_code",
                        args: { baseRevision: -1 },
                      },
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          });
        })(),
    });
    const output = await response.text();
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain('"type":"call"');
    expect(output).not.toContain('"type":"done"');
  });

  it("reports a failure after streamed text without fabricating a done event", async () => {
    let attempts = 0;
    const response = await handleAiRequest(request(), {
      generate: async () => {
        attempts++;
        return (async function* () {
          yield chunk({
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Partial answer" }] },
              },
            ],
          });
          throw { status: 503, message: "provider secret-key" };
        })();
      },
    });
    const output = await response.text();
    expect(output).toContain("Partial answer");
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain("secret-key");
    expect(output).not.toContain('"type":"done"');
    expect(attempts).toBe(1);
  });

  it("rejects exhausted local rate limits before calling the provider", async () => {
    const limiter = createRateLimiter(0);
    let requested = false;
    const response = await handleAiRequest(request(), {
      limiter,
      generate: async () => {
        requested = true;
        return (async function* () {})();
      },
    });
    expect(response.status).toBe(429);
    expect(requested).toBe(false);
  });

  it("rejects overlapping text patches and arbitrary board payloads", () => {
    expect(
      validateToolCall("edit_code", {
        baseRevision: 2,
        replacements: [
          { from: 0, to: 4, text: "" },
          { from: 2, to: 5, text: "" },
        ],
        summary: "Fix code",
      }),
    ).toBeUndefined();
    expect(
      validateToolCall("edit_board", {
        baseRevision: 1,
        additions: [{ type: "iframe", x: 0, y: 0, width: 10, height: 10 }],
        updates: [],
        deleteIds: [],
        summary: "Add",
      }),
    ).toBeUndefined();
    expect(
      validateToolCall("edit_notes", {
        baseRevision: 2,
        replacements: [{ from: 6, to: 6, text: "A note" }],
        summary: "Append",
      }),
    ).toEqual({
      baseRevision: 2,
      replacements: [{ from: 6, to: 6, text: "A note" }],
      summary: "Append",
    });
  });
});
