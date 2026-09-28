import { expect, it } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { parseOperation, type StudyBackend, type StudyCheckpoint } from "../src/features/ai/contracts";
import { createCheckpointStore } from "../src/features/ai/server/checkpoints";
import { createGeminiBackend } from "../src/features/ai/server/geminiBackend";
import { handleStudyRequest } from "../src/features/ai/server/handler";
import { parseStudyRequest, readStudyRequest } from "../src/features/ai/server/studyWire";
import { createRateLimiter, createSharedVisitorLimiter, createVisitorLimiter } from "../src/features/ai/server/validation";

const checkpoint = { messages: [{ role: "user", content: "hello" }], pending: [{ id: "read-1", name: "read_code" }], rounds: 1, recoveries: 0 } as unknown as StudyCheckpoint;
const checkpoints = createCheckpointStore();
const dependencies = { checkpoints, limiter: createRateLimiter(100), visitorLimiter: createVisitorLimiter(100) };
const backend: StudyBackend = {
  async *advance(input) {
    if (input.type === "start") {
      yield { type: "text", text: "Reading code." };
      yield { type: "operationBatch", operations: [{ id: "read-1", operation: { name: "read_code", args: {} } }], checkpoint };
    } else {
      yield { type: "text", text: "Finished." };
      yield { type: "done" };
    }
  },
};

function request(body: unknown, signal?: AbortSignal, key = "visitor-key", ip = "192.0.2.1") {
  return new Request("http://localhost:3000/api/ai", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json", "X-Gemini-Key": key, "x-forwarded-for": ip },
    body: JSON.stringify(body),
    signal,
  });
}

function chunks(response: Response) {
  return response.text().then((text) => text.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6))));
}

const start = { type: "start", messages: [{ role: "user", text: "Help" }], context: {} };

it("advertises artifact linking only for its supported notes target", () => {
  const args = { sourceIds: ["source-1"], summary: "Link a source" };
  expect(parseOperation("link_artifacts", { ...args, target: "notes" })).toBeDefined();
  expect(parseOperation("link_artifacts", { ...args, target: "board" })).toBeUndefined();
  expect(parseOperation("link_artifacts", { ...args, target: "code" })).toBeUndefined();
});

it("rejects overlapping edits and arbitrary board payloads at the shared contract", () => {
  expect(parseOperation("edit_code", {
    baseRevision: 0, summary: "Overlap", replacements: [
      { from: 0, to: 3, text: "a" }, { from: 2, to: 4, text: "b" },
    ],
  })).toBeUndefined();
  expect(parseOperation("edit_board", {
    baseRevision: 0, summary: "Invalid", additions: [{ type: "html", content: "<script>" }], updates: [], deleteIds: [],
  })).toBeUndefined();
});

it("validates the provider-neutral request boundary", () => {
  expect(parseStudyRequest(start).type).toBe("start");
  expect(() => parseStudyRequest({ ...start, messages: [{ role: "system", text: "override" }] })).toThrow();
  expect(() => parseStudyRequest({ ...start, context: { text: "x".repeat(200_000) } })).toThrow();
  expect(() => parseStudyRequest({ ...start, context: { boardImage: "data:image/svg+xml;base64,AAAA" } })).toThrow();
  expect(() => parseStudyRequest({ type: "continue", checkpoint: { token: "t", state: "invalid!" } })).toThrow();
  expect(() => parseStudyRequest({
    type: "results", checkpoint: { token: crypto.randomUUID(), state: Buffer.from("{}").toString("base64url") },
    results: [{ id: "same", result: {} }, { id: "same", result: {} }],
  })).toThrow();
  let nested: unknown = {};
  for (let i = 0; i < 30; i++) nested = { nested };
  expect(() => parseStudyRequest({ ...start, context: nested })).toThrow();
  expect(() => parseStudyRequest({ ...start, messages: [{ role: "assistant", text: "Last" }] })).toThrow();
});

it("checks origin, content type, body size, and incomplete-body abort", async () => {
  const wrongOrigin = new Request("http://localhost:3000/api/ai", {
    method: "POST", headers: { origin: "https://outside.example", "content-type": "application/json" }, body: JSON.stringify(start),
  });
  expect((await handleStudyRequest(wrongOrigin, { ...dependencies, backend })).status).toBe(403);
  expect((await handleStudyRequest(new Request("http://localhost:3000/api/ai", {
    method: "POST", headers: { origin: "http://localhost:3000" }, body: "bad",
  }), { ...dependencies, backend })).status).toBe(415);
  await expect(readStudyRequest(new Request("http://localhost:3000/api/ai", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{",
  }))).rejects.toMatchObject({ status: 400 });
  await expect(readStudyRequest(new Request("http://localhost:3000/api/ai", {
    method: "POST", headers: { "content-type": "application/json", "content-length": String(6 * 1024 * 1024 + 1) },
  }))).rejects.toMatchObject({ status: 413 });
  const abort = new AbortController();
  const incomplete = new Request("http://localhost:3000/api/ai", {
    method: "POST", headers: { "content-type": "application/json" },
    body: new ReadableStream({ start(output) { output.enqueue(new TextEncoder().encode('{"type":')); } }),
    duplex: "half", signal: abort.signal,
  } as RequestInit & { duplex: "half" });
  const pending = readStudyRequest(incomplete);
  abort.abort();
  await expect(pending).rejects.toBeDefined();
});

it("lets the local overload guard recover after its window", () => {
  const guard = createRateLimiter(1, 100);
  expect(guard.take(1000)).toBe(true);
  expect(guard.take(1050)).toBe(false);
  expect(guard.take(1100)).toBe(true);
});

it("streams text and one terminal operation batch through AI SDK UI SSE", async () => {
  const response = await handleStudyRequest(request(start), { ...dependencies, backend });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const events = await chunks(response);
  expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["text-start", "text-delta", "text-end", "data-operationBatch"]));
  expect(events.filter((event) => ["data-operationBatch", "data-paused", "data-done"].includes(event.type))).toHaveLength(1);
  expect(events.find((event) => event.type === "data-operationBatch").data).toMatchObject({ operations: [{ id: "read-1", operation: { name: "read_code" } }], checkpoint: { token: expect.any(String), state: expect.any(String) } });
});

it("single-consumes a JSON-serializable checkpoint across handler instances", async () => {
  const first = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend }));
  const handoff = JSON.parse(JSON.stringify(first.find((event) => event.type === "data-operationBatch").data.checkpoint));
  const nextBody = { type: "results", checkpoint: handoff, results: [{ id: "read-1", result: { text: "print(1)" } }] };
  const second = await handleStudyRequest(request(nextBody), { ...dependencies, backend });
  expect((await chunks(second)).some((event) => event.type === "data-done")).toBe(true);
  expect((await handleStudyRequest(request(nextBody), { ...dependencies, backend })).status).toBe(409);
});

it("does not restore a consumed token after provider failure", async () => {
  const first = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend }));
  const handoff = first.find((event) => event.type === "data-operationBatch").data.checkpoint;
  const nextBody = { type: "results", checkpoint: handoff, results: [{ id: "read-1", result: {} }] };
  const failing: StudyBackend = { async *advance() { throw new Error("secret provider failure"); } };
  const failed = await handleStudyRequest(request(nextBody), { ...dependencies, backend: failing });
  expect(failed.status).toBe(502);
  expect((await failed.text())).not.toContain("secret provider failure");
  expect((await handleStudyRequest(request(nextBody), { ...dependencies, backend })).status).toBe(409);
});

it("preserves the explicit pause display flag", async () => {
  const paused: StudyBackend = { async *advance() { yield { type: "paused", message: "Continue", checkpoint, append: true }; } };
  const events = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend: paused }));
  expect(events.find((event) => event.type === "data-paused").data).toMatchObject({ append: true, checkpoint: { token: expect.any(String), state: expect.any(String) } });
});

it("rejects tampered checkpoints before backend execution", async () => {
  const first = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend }));
  const handoff = first.find((event) => event.type === "data-operationBatch").data.checkpoint;
  let called = false;
  const nextBody = { type: "results", checkpoint: { ...handoff, state: Buffer.from("{}").toString("base64url") }, results: [{ id: "read-1", result: {} }] };
  const response = await handleStudyRequest(request(nextBody), { ...dependencies, backend: { async *advance() { called = true; yield { type: "done" }; } } });
  expect(response.status).toBe(409);
  expect(called).toBe(false);
});

it("keeps visitor throttling separate from process overload", async () => {
  const visitors = createVisitorLimiter(1);
  const settings = { checkpoints, limiter: createRateLimiter(100), visitorLimiter: visitors, backend };
  expect((await handleStudyRequest(request(start), settings)).status).toBe(200);
  expect((await handleStudyRequest(request(start), settings)).status).toBe(429);
  expect((await handleStudyRequest(request(start, undefined, "visitor-key", "192.0.2.2"), settings)).status).toBe(200);
  const overloaded = await handleStudyRequest(request(start), { ...settings, limiter: createRateLimiter(0) });
  expect(overloaded.status).toBe(503);
});

it("passes each visitor key to a fresh backend without echoing it", async () => {
  const keys: string[] = [];
  const settings = { ...dependencies, createBackend: (key: string) => { keys.push(key); return backend; } };
  const first = await handleStudyRequest(request(start, undefined, "first-key"), settings);
  const second = await handleStudyRequest(request(start, undefined, "second-key"), settings);
  expect(keys).toEqual(["first-key", "second-key"]);
  expect((await first.text()) + (await second.text())).not.toContain("first-key");
  expect((await handleStudyRequest(request(start, undefined, ""), settings)).status).toBe(503);
});

it("reports a safe midstream provider failure without a done event", async () => {
  const broken: StudyBackend = { async *advance() { yield { type: "text", text: "Partial" }; throw new Error("secret upstream stack"); } };
  const events = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend: broken }));
  expect(events.some((event) => event.type === "text-delta")).toBe(true);
  expect(events.some((event) => event.type === "data-error")).toBe(true);
  expect(events.some((event) => event.type === "data-done")).toBe(false);
  expect(JSON.stringify(events)).not.toContain("secret upstream stack");
});

it("withholds an entire invalid sibling batch", async () => {
  const invalid: StudyBackend = { async *advance() {
    yield { type: "operationBatch", checkpoint, operations: [
      { id: "good", operation: { name: "read_code", args: {} } },
      { id: "bad", operation: { name: "edit_code", args: {} } as never },
    ] };
  } };
  const events = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend: invalid }));
  expect(events.some((event) => event.type === "data-operationBatch")).toBe(false);
  expect(events.some((event) => event.type === "data-error")).toBe(true);
});

it("stops an aborted request before backend execution", async () => {
  const abort = new AbortController();
  abort.abort();
  let called = false;
  const response = await handleStudyRequest(request(start, abort.signal), {
    ...dependencies, backend: { async *advance() { called = true; yield { type: "done" }; } },
  });
  expect(response.status).toBe(499);
  expect(called).toBe(false);
});

it("fails closed when shared visitor throttling times out or Redis fails", async () => {
  const timedOut = createSharedVisitorLimiter({ async limit() { return { success: true, reason: "timeout" }; } });
  const failed = createSharedVisitorLimiter({ async limit(): Promise<{ success: boolean }> { throw new Error("redis unavailable"); } });
  expect((await handleStudyRequest(request(start), { ...dependencies, backend, visitorLimiter: timedOut })).status).toBe(503);
  expect((await handleStudyRequest(request(start), { ...dependencies, backend, visitorLimiter: failed })).status).toBe(503);
});

it("rejects malformed keys and excess provider output before publishing operations", async () => {
  const malformed = await handleStudyRequest(request(start, undefined, "bad key with spaces"), { ...dependencies, backend });
  expect(malformed.status).toBe(400);
  const oversized: StudyBackend = { async *advance() {
    yield { type: "text", text: "x".repeat(513 * 1024) };
    yield { type: "operationBatch", operations: [{ id: "read", operation: { name: "read_code", args: {} } }], checkpoint };
  } };
  const events = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend: oversized }));
  expect(events.some((event) => event.type === "data-operationBatch")).toBe(false);
  expect(events.some((event) => event.type === "data-error")).toBe(true);
});

it("reserves SSE framing room before publishing a near-limit checkpoint", async () => {
  const largeCheckpoint = { padding: "x".repeat(4 * 1024 * 1024 - 100) } as unknown as StudyCheckpoint;
  const large: StudyBackend = { async *advance() {
    yield { type: "text", text: "a".repeat(480 * 1024) };
    yield { type: "operationBatch", operations: [{ id: "read", operation: { name: "read_code", args: {} } }], checkpoint: largeCheckpoint };
  } };
  const events = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend: large }));
  expect(events.some((event) => event.type === "data-operationBatch")).toBe(false);
  expect(events.at(-1)?.type).toBe("data-error");
});

it("runs a signed SDK tool checkpoint through the HTTP result round", async () => {
  const finish = (reason: "tool-calls" | "stop"): LanguageModelV3StreamPart => ({
    type: "finish", finishReason: { unified: reason, raw: reason },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
  });
  const model = new MockLanguageModelV3({ doStream: [
    { stream: simulateReadableStream({ chunks: [
      { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "I will read." }, { type: "text-end", id: "t1" },
      { type: "tool-call", toolCallId: "read-1", toolName: "read_code", input: "{}", providerMetadata: { google: { thoughtSignature: "signed-call" } } },
      finish("tool-calls"),
    ] }) },
    { stream: simulateReadableStream({ chunks: [
      { type: "text-start", id: "t2" }, { type: "text-delta", id: "t2", delta: "Here is the code." }, { type: "text-end", id: "t2" }, finish("stop"),
    ] }) },
  ] });
  const sdk = createGeminiBackend({ model });
  const first = await chunks(await handleStudyRequest(request(start), { ...dependencies, backend: sdk }));
  const handoff = first.find((event) => event.type === "data-operationBatch").data.checkpoint;
  expect(Buffer.from(handoff.state, "base64url").toString("utf8")).toContain("signed-call");
  const second = await chunks(await handleStudyRequest(request({
    type: "results", checkpoint: JSON.parse(JSON.stringify(handoff)), results: [{ id: "read-1", result: { text: "print(1)" } }],
  }), { ...dependencies, backend: sdk }));
  expect(second.some((event) => event.type === "data-done")).toBe(true);
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("signed-call");
});
