import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

type Event = Record<string, unknown>;

/** Keep domain fixtures compact while exercising the installed AI SDK UI wire format. */
export function uiResponse(events: Event[]): Response {
  const stream = createUIMessageStream({
    execute({ writer }) {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "answer" });
      let textEnded = false;
      const endText = () => {
        if (textEnded) return;
        writer.write({ type: "text-end", id: "answer" });
        textEnded = true;
      };
      const calls: { id: string; operation: { name: string; args: unknown } }[] = [];
      for (const event of events) {
        if (event.type === "text")
          writer.write({ type: "text-delta", id: "answer", delta: String(event.text) });
        else if (event.type === "replace")
          writer.write({ type: "data-replace", data: { text: event.text }, transient: true });
        else if (event.type === "status")
          writer.write({ type: "data-status", data: { message: event.message }, transient: true });
        else if (event.type === "call")
          calls.push({ id: String(event.id), operation: { name: String(event.name), args: event.args } });
        else if (event.type === "paused") {
          endText();
          writer.write({
            type: "data-paused",
            data: {
              message: event.message,
              checkpoint: event.checkpoint ?? { token: "fixture-token", state: "fixture-state" },
              append: event.append ?? true,
            },
            transient: true,
          });
        } else if (event.type === "done") {
          endText();
          if (calls.length) {
            writer.write({
              type: "data-operationBatch",
              data: { operations: calls, checkpoint: event.checkpoint ?? { token: "fixture-token", state: "fixture-state" } },
              transient: true,
            });
          } else writer.write({ type: "data-done", data: {}, transient: true });
        } else if (event.type === "error") {
          endText();
          writer.write({ type: "data-error", data: { message: event.message }, transient: true });
        }
      }
      endText();
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
