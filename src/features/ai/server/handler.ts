import { randomUUID } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { parseOperation, type OperationCall, type StudyBackend, type StudyEvent, type StudyTurnInput } from "../contracts";
import { configuredCheckpointStore, type CheckpointStore } from "./checkpoints";
import { createGeminiBackend } from "./geminiBackend";
import { decodeCheckpoint, encodeCheckpoint, readStudyRequest } from "./studyWire";
import {
  AiRequestError,
  configuredVisitorLimiter,
  createRateLimiter,
  mapAiError,
  readProviderKey,
  validateOrigin,
  visitorIdentity,
  type VisitorLimiter,
} from "./validation";

type Dependencies = {
  backend?: StudyBackend;
  createBackend?: (apiKey: string) => StudyBackend;
  checkpoints?: CheckpointStore;
  limiter?: ReturnType<typeof createRateLimiter>;
  visitorLimiter?: VisitorLimiter;
};

const localLimiter = createRateLimiter();
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_UI_STREAM_BYTES = 6 * 1024 * 1024;
const SSE_FRAMING_RESERVE = 256 * 1024;

function validatedBatch(operations: OperationCall[]): OperationCall[] {
  if (!operations.length || operations.length > 12)
    throw new AiRequestError(502, "Gemini requested too many operations. Try a smaller step.");
  const ids = new Set<string>();
  return operations.map((call) => {
    const operation = parseOperation(call.operation.name, call.operation.args);
    if (!operation || !call.id || call.id.length > 200 || ids.has(call.id))
      throw new AiRequestError(502, "Gemini returned an invalid operation. No change was applied.");
    ids.add(call.id);
    return { id: call.id, operation };
  });
}

export async function handleStudyRequest(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(55_000)]);
  let iterator: AsyncIterator<StudyEvent> | undefined;
  try {
    validateOrigin(request);
    const apiKey = readProviderKey(request, "X-Gemini-Key");
    if (!apiKey && !dependencies.backend)
      throw new AiRequestError(503, "Add your Gemini API key in Settings to chat.");
    if (!(dependencies.limiter ?? localLimiter).take())
      throw new AiRequestError(503, "The AI service is busy. Try again shortly.");
    if (!(await (dependencies.visitorLimiter ?? configuredVisitorLimiter()).take(visitorIdentity(request))))
      throw new AiRequestError(429, "Too many AI requests. Wait a moment before trying again.");
    const body = await readStudyRequest(request);
    signal.throwIfAborted();
    const checkpoints = dependencies.checkpoints ?? configuredCheckpointStore();
    let input: StudyTurnInput;
    if (body.type === "start") {
      input = body;
    } else {
      const kind = body.type === "results" ? "tool" : "resume";
      // A consumed token is never reissued after a provider failure. The user
      // starts a fresh turn, avoiding duplicate execution across instances.
      await checkpoints.take(kind, body.checkpoint.token, body.checkpoint.state);
      const checkpoint = decodeCheckpoint(body.checkpoint.state);
      input = body.type === "results"
        ? { type: "results", checkpoint, results: body.results }
        : { type: "continue", checkpoint };
    }
    const backend = dependencies.backend ?? (dependencies.createBackend
      ? dependencies.createBackend(apiKey!)
      : createGeminiBackend({ apiKey }));
    iterator = backend.advance(input, signal)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new AiRequestError(502, "Gemini returned an empty response. Please try again.");
    if (first.value.type === "error") throw new AiRequestError(502, first.value.message);
    signal.throwIfAborted();

    const stream = createUIMessageStream({
      async execute({ writer }) {
        const textId = randomUUID();
        let textStarted = false;
        let terminal = false;
        let outputBytes = 0;
        let eventCount = 0;
        const writeTextEnd = () => {
          if (textStarted) writer.write({ type: "text-end", id: textId });
          textStarted = false;
        };
        const checkCheckpointSize = (state: string) => {
          if (Buffer.byteLength(state) + outputBytes + SSE_FRAMING_RESERVE > MAX_UI_STREAM_BYTES)
            throw new AiRequestError(502, "Gemini returned too much data. Try a smaller request.");
        };
        try {
          let next: IteratorResult<StudyEvent> = first;
          while (!next.done) {
            signal.throwIfAborted();
            const event = next.value;
            outputBytes += Buffer.byteLength(JSON.stringify(
              event.type === "operationBatch" ? event.operations :
              event.type === "paused" ? event.message : event,
            ));
            if (++eventCount > 1024 || outputBytes > 512 * 1024)
              throw new AiRequestError(502, "Gemini returned too much data. Try a smaller request.");
            if (event.type === "text") {
              if (!textStarted) {
                writer.write({ type: "text-start", id: textId });
                textStarted = true;
              }
              writer.write({ type: "text-delta", id: textId, delta: event.text });
            } else if (event.type === "replace") {
              writer.write({ type: "data-replace", data: { text: event.text } });
            } else if (event.type === "status") {
              writer.write({ type: "data-status", data: { message: event.message } });
            } else if (event.type === "operationBatch") {
              const operations = validatedBatch(event.operations);
              if (!event.checkpoint) throw new AiRequestError(502, "Gemini returned an incomplete operation batch.");
              const state = encodeCheckpoint(event.checkpoint);
              checkCheckpointSize(state);
              const token = await checkpoints.issue("tool", state);
              writeTextEnd();
              writer.write({ type: "data-operationBatch", data: { operations, checkpoint: { token, state } } });
              terminal = true;
              break;
            } else if (event.type === "paused") {
              const state = encodeCheckpoint(event.checkpoint);
              checkCheckpointSize(state);
              const token = await checkpoints.issue("resume", state);
              writeTextEnd();
              writer.write({ type: "data-paused", data: { message: event.message, checkpoint: { token, state }, append: event.append } });
              terminal = true;
              break;
            } else if (event.type === "done") {
              writeTextEnd();
              writer.write({ type: "data-done", data: {} });
              terminal = true;
              break;
            } else if (event.type === "error") {
              throw new AiRequestError(502, event.message);
            }
            next = await iterator!.next();
          }
          if (!terminal) throw new AiRequestError(502, "Gemini returned an incomplete response.");
        } catch (error) {
          writeTextEnd();
          writer.write({ type: "data-error", data: { message: mapAiError(signal.aborted ? signal.reason : error).message } });
        } finally {
          controller.abort();
          await iterator?.return?.().catch(() => undefined);
        }
      },
      onError: (error) => mapAiError(error).message,
    });
    return createUIMessageStreamResponse({ stream, headers: { ...headers, "X-Accel-Buffering": "no" } });
  } catch (error) {
    const mapped = mapAiError(signal.aborted ? signal.reason : error);
    controller.abort();
    await iterator?.return?.().catch(() => undefined);
    return Response.json({ type: "error", message: mapped.message }, {
      status: mapped.status,
      headers: { ...headers, ...(mapped.status === 429 ? { "Retry-After": "30" } : {}) },
    });
  }
}
