import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Content, GenerateContentResponse, Part } from "@google/genai";
import { buildContents, generateStream, type GenerateStream } from "./provider";
import {
  createBudgetStore,
  generationLimits,
  newBudget,
  type GenerationLimits,
} from "./budget";
import { toolNames, toolValidationIssues, validateToolCall } from "./tools";
import {
  AiRequestError,
  MAX_CONTINUATION_BYTES,
  createRateLimiter,
  mapAiError,
  readAiRequest,
  validateOrigin,
} from "./validation";

const localLimiter = createRateLimiter();
const localBudgets = createBudgetStore();
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
type Dependencies = {
  generate?: GenerateStream;
  limiter?: ReturnType<typeof createRateLimiter>;
  budgets?: ReturnType<typeof createBudgetStore>;
  limits?: GenerationLimits;
};
const continueInstruction =
  "Continue the unfinished answer exactly where it stopped. Do not repeat previous text or restart an open code block. Finish the current explanation concisely.";
const repairInstruction =
  "The previous proposed operation batch was rejected before execution. No operation in that batch was executed or approved. Correct the validation issues and return a small, complete operation using the declared tool schemas. Preserve exact revisions; read current data if needed. Do not claim a change was applied.";
const knownTools = new Set<string>(toolNames);

// Only replay envelopes that the browser can return in a continuation. A
// malformed envelope is regenerated as a whole, never edited inside signed parts.
function replayableCalls(calls: NonNullable<Part["functionCall"]>[]): boolean {
  const ids = new Set<string>();
  return calls.every((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) return false;
    if (Object.keys(call).some((key) => !["id", "name", "args"].includes(key))) return false;
    if (typeof call.name !== "string" || !knownTools.has(call.name)) return false;
    if (call.id !== undefined) {
      if (typeof call.id !== "string" || !call.id.length || call.id.length > 200 || ids.has(call.id)) return false;
      ids.add(call.id);
    }
    return call.args === undefined || (call.args !== null && typeof call.args === "object" && !Array.isArray(call.args));
  });
}

// The model narrates and calls a tool in the same turn, so once the tool
// result arrives it often has nothing left to add. That silent turn is the
// end of a step, not a failure. Repair feedback and continue instructions
// carry a text part, so they are excluded and still require a real answer.
function followsToolResults(contents: Content[]): boolean {
  const last = contents.at(-1);
  return (
    last?.role === "user" &&
    !!last.parts?.length &&
    last.parts.every((part) => part.functionResponse)
  );
}

function checkContinuation(contents: Content[]) {
  if (
    contents.length > 32 ||
    Buffer.byteLength(JSON.stringify(contents)) > MAX_CONTINUATION_BYTES
  )
    throw new AiRequestError(
      413,
      "This conversation step is too large. Start a smaller request.",
    );
}

export async function handleAiRequest(
  request: Request,
  dependencies: Dependencies = {},
): Promise<Response> {
  const controller = new AbortController();
  // All recovery attempts share this deadline; none gets a fresh timeout.
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
    const budgets = dependencies.budgets ?? localBudgets;
    const identity = { messages: body.messages, context: body.context };
    const fingerprint = (contents: Content[], append?: boolean) => ({
      ...identity,
      contents,
      ...(append === undefined ? {} : { append }),
    });
    let budget = newBudget(dependencies.limits ?? generationLimits());
    if (body.continuation)
      budget = budgets.take(
        "tool",
        body.continuation.token,
        fingerprint(body.continuation.contents as Content[]),
      );
    if (body.resume) {
      const prior = budgets.take(
        "resume",
        body.resume.token,
        fingerprint(body.resume.contents as Content[], body.resume.append),
      );
      budget = newBudget(prior);
    }
    let contents = body.resume
      ? (body.resume.contents as Content[])
      : buildContents(body);
    let append = body.resume?.append ?? false;
    const openGeneration = async (recovery = false) => {
      signal.throwIfAborted();
      const provider = await (dependencies.generate ?? generateStream)(
        contents,
        signal,
        recovery,
      );
      iterator = provider[Symbol.asyncIterator]();
      return iterator.next();
    };
    let first: IteratorResult<GenerateContentResponse> | undefined;
    if (budget.rounds < 8) {
      budget.rounds++;
      // Preserve meaningful HTTP errors before streaming. Even this transient
      // retry consumes the same recovery count.
      for (let attempt = 0; ; attempt++) {
        try {
          first = await openGeneration(attempt > 0);
          break;
        } catch (error) {
          if (
            attempt !== 0 ||
            (error as { status?: number } | null)?.status !== 503 ||
            error instanceof AiRequestError ||
            signal.aborted ||
            budget.recovered >= budget.recoveries
          )
            throw error;
          budget.recovered++;
          await iterator?.return?.().catch(() => undefined);
          iterator = undefined;
          await delay(750, undefined, { signal });
        }
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
        const pause = () => {
          checkContinuation(contents);
          const token = budgets.issue(
            "resume",
            fingerprint(contents, append),
            budget,
          );
          emit({
            type: "paused",
            message:
              "Paused at this request's limit. Continue when you're ready.",
            resume: { contents, token, append },
          });
        };
        let visibleText = "";
        let outputBytes = 0;
        try {
          if (!first) {
            pause();
            return;
          }
          let item = first;
          while (true) {
            const parts: Part[] = [];
            let finishReason: string | undefined;
            let usage: GenerateContentResponse["usageMetadata"];
            const beforeAttempt = visibleText;
            while (!item.done) {
              signal.throwIfAborted();
              const chunk = item.value;
              if (chunk.usageMetadata) usage = chunk.usageMetadata;
              if (chunk.promptFeedback?.blockReason)
                throw new AiRequestError(
                  422,
                  "Gemini could not respond to this request. Try rephrasing it.",
                );
              const candidate = chunk.candidates?.[0];
              if (candidate?.finishReason)
                finishReason = candidate.finishReason;
              for (const part of candidate?.content?.parts ?? []) {
                // Preserve provider parts and opaque signatures without merging.
                parts.push(part);
                outputBytes += Buffer.byteLength(JSON.stringify(part));
                if (outputBytes > 512 * 1024 || parts.length > 1_024)
                  throw new AiRequestError(
                    502,
                    "Gemini returned too much data. Try a smaller request.",
                  );
                if (part.text && !part.thought) {
                  visibleText += part.text;
                  emit({ type: "text", text: part.text });
                }
              }
              item = await iterator!.next();
            }
            signal.throwIfAborted();
            if (!dependencies.generate)
              console.info("[ai-usage]", {
                model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
                finishReason,
                outputTokens: usage?.candidatesTokenCount,
                thinkingTokens: usage?.thoughtsTokenCount,
                recoveries: budget.recovered,
              });

            const calls = parts.flatMap((part) =>
              part.functionCall ? [part.functionCall] : [],
            );
            if (finishReason === "MAX_TOKENS") {
              if (calls.length === 0 && visibleText !== beforeAttempt) {
                contents = [
                  ...contents,
                  { role: "model", parts },
                  { role: "user", parts: [{ text: continueInstruction }] },
                ];
                append = true;
              } else {
                // An incomplete tool attempt is regenerated, never stitched or
                // applied. Roll back only its displayed text, not earlier work.
                if (visibleText !== beforeAttempt)
                  emit({ type: "replace", text: beforeAttempt });
                visibleText = beforeAttempt;
              }
              checkContinuation(contents);
              if (budget.recovered >= budget.recoveries) {
                pause();
                return;
              }
              budget.recovered++;
              emit({ type: "status", message: "Continuing the response…" });
              await iterator?.return?.().catch(() => undefined);
              iterator = undefined;
              item = await openGeneration(true);
              continue;
            }
            if (finishReason !== "STOP")
              throw new AiRequestError(
                502,
                "Gemini could not finish this response. Try rephrasing the request.",
              );
            if (
              !parts.some(
                (part) => (part.text && !part.thought) || part.functionCall,
              )
            ) {
              if (followsToolResults(contents)) {
                emit({ type: "done", continuation: { contents } });
                return;
              }
              throw new AiRequestError(
                502,
                "Gemini returned an empty response. Please try again.",
              );
            }
            if (calls.length > 12)
              throw new AiRequestError(
                502,
                "Gemini requested too many operations. Try a smaller step.",
              );
            const replayable = replayableCalls(calls);
            const validated = replayable
              ? calls.map((call) => validateToolCall(call.name!, call.args ?? {}))
              : [];
            if (!replayable || validated.some((args) => !args)) {
              // No sibling call escapes a rejected batch, even if that sibling
              // was valid. Retract only this attempt's visible explanation.
              if (visibleText !== beforeAttempt)
                emit({ type: "replace", text: beforeAttempt });
              visibleText = beforeAttempt;
              if (budget.recovered >= budget.recoveries)
                throw new AiRequestError(
                  502,
                  "Gemini could not produce a valid operation after correction. No change from this step was applied; try a smaller request.",
                );
              const feedback: Content = replayable
                ? {
                    role: "user",
                    parts: [
                      ...calls.map((call, index): Part => ({
                        functionResponse: {
                          ...(call.id ? { id: call.id } : {}),
                          name: call.name,
                          response: {
                            output: validated[index]
                              ? { status: "not_executed", message: "Another operation in this batch was invalid. No operation in this batch was executed." }
                              : { status: "invalid_arguments", message: "No operation in this batch was executed.", issues: toolValidationIssues(call.name!, call.args ?? {}) },
                          },
                        },
                      })),
                      { text: repairInstruction },
                    ],
                  }
                : {
                    role: "user",
                    parts: [{ text: `${repairInstruction} Use a declared tool name, object arguments, and distinct nonempty call IDs when supplying IDs.` }],
                  };
              const repaired: Content[] = [
                ...contents,
                ...(replayable ? [{ role: "model", parts } satisfies Content] : []),
                feedback,
              ];
              checkContinuation(repaired);
              contents = repaired;
              budget.recovered++;
              emit({ type: "status", message: "Correcting the proposed change…" });
              await iterator?.return?.().catch(() => undefined);
              iterator = undefined;
              item = await openGeneration(true);
              continue;
            }
            const validatedCalls = calls.map((call, index) => ({
              type: "call",
              id: call.id ?? randomUUID(),
              name: call.name!,
              args: validated[index]!,
            }));
            const continued: Content[] = [
              ...contents,
              { role: "model", parts },
            ];
            checkContinuation(continued);
            const token = calls.length
              ? budgets.issue("tool", fingerprint(continued), budget)
              : undefined;
            for (const call of validatedCalls) emit(call);
            emit({
              type: "done",
              continuation: {
                contents: continued,
                ...(token ? { token } : {}),
              },
            });
            return;
          }
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
