import type { Route } from "@playwright/test";
import type { StudyCheckpoint, StudyEvent } from "../../src/features/ai/contracts";

/** Browser fixtures model the study backend; only this helper knows UI SSE framing. */
export function fixtureCheckpoint(token: string): StudyCheckpoint {
  return { token, state: "fixture-state" } as unknown as StudyCheckpoint;
}

export async function fulfillStudyStream(route: Route, events: StudyEvent[]) {
  const parts: object[] = [{ type: "start" }];
  let textId = 0;
  for (const event of events) {
    if (event.type === "text") {
      const id = `fixture-text-${textId++}`;
      parts.push({ type: "text-start", id }, { type: "text-delta", id, delta: event.text }, { type: "text-end", id });
    } else if (event.type === "operationBatch") {
      parts.push({ type: "data-operationBatch", data: { operations: event.operations, checkpoint: event.checkpoint } });
    } else if (event.type === "paused") {
      parts.push({ type: "data-paused", data: { message: event.message, checkpoint: event.checkpoint, append: event.append } });
    } else if (event.type === "done") {
      parts.push({ type: "data-done", data: {} });
    } else if (event.type === "error") {
      parts.push({ type: "data-error", data: { message: event.message } });
    } else if (event.type === "status") {
      parts.push({ type: "data-status", data: { message: event.message } });
    } else if (event.type === "replace") {
      parts.push({ type: "data-replace", data: { text: event.text } });
    }
  }
  parts.push({ type: "finish" });
  await route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    headers: { "x-vercel-ai-ui-message-stream": "v1" },
    body: parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n",
  });
}
