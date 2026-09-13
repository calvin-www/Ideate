import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Content, GenerateContentResponse, Part } from "@google/genai";
import { buildContents, generateStream, type GenerateStream } from "./provider";
import { validateToolCall } from "./tools";
import {
  AiRequestError,
  MAX_CONTINUATION_BYTES,
  createRateLimiter,
  mapAiError,
  readAiRequest,
  validateOrigin,
} from "./validation";

const localLimiter = createRateLimiter();
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
type Dependencies = {
  generate?: GenerateStream;
  limiter?: ReturnType<typeof createRateLimiter>;
};

export async function handleAiRequest(
  request: Request,
  dependencies: Dependencies = {},
): Promise<Response> {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(55_000),
  ]);
  let iterator: AsyncIterator<GenerateContentResponse> | undefined;
  try {
    validateOrigin(request);
    if (!(dependencies.limiter ?? localLimiter).take())
      throw new AiRequestError(
        429,
        "Too many AI requests. Wait a moment before trying again.",
      );
    const body = await readAiRequest(request);
    signal.throwIfAborted();
    const contents = buildContents(body);
    // Receive the first chunk before HTTP headers, so upstream access/rate
    // failures have meaningful HTTP statuses. Retry only a transient provider
    // 503 before any chunk; replaying an existing stream could duplicate work.
    let first: IteratorResult<GenerateContentResponse>;
    for (let attempt = 0; ; attempt++) {
      try {
        signal.throwIfAborted();
        const provider = await (dependencies.generate ?? generateStream)(
          contents,
          signal,
        );
        iterator = provider[Symbol.asyncIterator]();
        first = await iterator.next();
        break;
      } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        if (
          attempt !== 0 ||
          status !== 503 ||
          error instanceof AiRequestError ||
          signal.aborted
        )
          throw error;
        await iterator?.return?.().catch(() => undefined);
        iterator = undefined;
        await delay(750, undefined, { signal });
      }
    }
    signal.throwIfAborted();
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (event: unknown) => {
          signal.throwIfAborted();
          if (!cancelled)
            output.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        const parts: Part[] = [];
        let finishReason: string | undefined;
        let outputBytes = 0;
        try {
          let item = first;
          while (!item.done) {
            signal.throwIfAborted();
            const chunk = item.value;
            if (chunk.promptFeedback?.blockReason)
              throw new AiRequestError(
                422,
                "Gemini could not respond to this request. Try rephrasing it.",
              );
            const candidate = chunk.candidates?.[0];
            if (candidate?.finishReason) finishReason = candidate.finishReason;
            for (const part of candidate?.content?.parts ?? []) {
              // Never reconstruct a function-call part: thought signatures and
              // adjacent provider parts must survive the next tool round.
              parts.push(part);
              outputBytes += Buffer.byteLength(JSON.stringify(part));
              if (outputBytes > 512 * 1024 || parts.length > 1_024)
                throw new AiRequestError(
                  502,
                  "Gemini returned too much data. Try a smaller request.",
                );
              if (part.text && !part.thought)
                emit({ type: "text", text: part.text });
            }
            item = await iterator!.next();
          }
          signal.throwIfAborted();
          if (finishReason && finishReason !== "STOP")
            throw new AiRequestError(
              502,
              finishReason === "MAX_TOKENS"
                ? "The answer reached its length limit. Try a smaller step."
                : "Gemini could not finish this response. Try rephrasing the request.",
            );
          if (
            !parts.some(
              (part) => (part.text && !part.thought) || part.functionCall,
            )
          )
            throw new AiRequestError(
              502,
              "Gemini returned an empty response. Please try again.",
            );
          const calls = parts.flatMap((part) =>
            part.functionCall ? [part.functionCall] : [],
          );
          if (calls.length > 12)
            throw new AiRequestError(
              502,
              "Gemini requested too many operations. Try a smaller step.",
            );
          const validatedCalls = calls.map((call) => {
            const args = validateToolCall(call.name ?? "", call.args ?? {});
            if (!args)
              throw new AiRequestError(
                502,
                "Gemini proposed an invalid operation. No change was applied; please try again.",
              );
            return {
              type: "call",
              id: call.id ?? randomUUID(),
              name: call.name!,
              args,
            };
          });
          const continued: Content[] = [...contents, { role: "model", parts }];
          if (
            Buffer.byteLength(JSON.stringify(continued)) >
            MAX_CONTINUATION_BYTES
          )
            throw new AiRequestError(
              413,
              "This conversation step is too large. Start a smaller request.",
            );
          for (const call of validatedCalls) emit(call);
          emit({ type: "done", continuation: { contents: continued } });
        } catch (error) {
          if (!cancelled) {
            const mapped = mapAiError(signal.aborted ? signal.reason : error);
            output.enqueue(
              encoder.encode(
                JSON.stringify({ type: "error", message: mapped.message }) +
                  "\n",
              ),
            );
          }
        } finally {
          controller.abort();
          if (!cancelled) output.close();
          await iterator?.return?.().catch(() => undefined);
        }
      },
      cancel() {
        cancelled = true;
        controller.abort();
      },
    });
    return new Response(stream, {
      headers: {
        ...headers,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const mapped = mapAiError(signal.aborted ? signal.reason : error);
    controller.abort();
    await iterator?.return?.().catch(() => undefined);
    return Response.json(
      { type: "error", message: mapped.message },
      {
        status: mapped.status,
        headers: {
          ...headers,
          ...(mapped.status === 429 ? { "Retry-After": "30" } : {}),
        },
      },
    );
  }
}
