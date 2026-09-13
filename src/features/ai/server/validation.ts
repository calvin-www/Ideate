import { z } from "zod";
import type { Content } from "@google/genai";
import { toolNames } from "./tools";

export const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 192 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_CONTINUATION_BYTES = 4 * 1024 * 1024;

export class AiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

const id = z.string().min(1).max(200);
const toolName = z.enum(toolNames);
const jsonRecord = z.record(z.string(), z.unknown());
const imageSchema = z.strictObject({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z
    .string()
    .min(4)
    .max(MAX_IMAGE_BYTES)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});

// Keep complete provider parts, including opaque signatures. Only content
// kinds used by this app can come back from the browser.
const partSchema = z.strictObject({
  text: z
    .string()
    .max(128 * 1024)
    .optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z
    .string()
    .max(128 * 1024)
    .optional(),
  functionCall: z
    .strictObject({
      id: id.optional(),
      name: toolName,
      args: jsonRecord.optional(),
    })
    .optional(),
  functionResponse: z
    .strictObject({ id: id.optional(), name: toolName, response: jsonRecord })
    .optional(),
  inlineData: imageSchema.optional(),
  partMetadata: jsonRecord.optional(),
});
const contentSchema = z.strictObject({
  role: z.enum(["user", "model"]),
  parts: z.array(partSchema).min(1).max(1_024),
});
const requestSchema = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        text: z
          .string()
          .min(1)
          .max(24 * 1024),
      }),
    )
    .min(1)
    .max(8),
  context: jsonRecord,
  continuation: z
    .strictObject({ contents: z.array(contentSchema).min(1).max(32) })
    .optional(),
  toolResults: z
    .array(
      z.strictObject({
        id: id.optional(),
        name: toolName,
        result: z.unknown(),
      }),
    )
    .min(1)
    .max(12)
    .optional(),
});

export type AiRequest = z.infer<typeof requestSchema>;

function checkJson(value: unknown, maxBytes: number): void {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let entries = 0;
  while (queue.length) {
    const current = queue.pop()!;
    if (++entries > 75_000 || current.depth > 24)
      throw new AiRequestError(
        413,
        "This context is too complex. Try a smaller selection.",
      );
    if (current.value !== null && typeof current.value === "object") {
      for (const item of Object.values(current.value))
        queue.push({ value: item, depth: current.depth + 1 });
    } else if (
      current.value === undefined ||
      (typeof current.value === "number" && !Number.isFinite(current.value))
    ) {
      throw new AiRequestError(400, "The request contains invalid data.");
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes)
    throw new AiRequestError(
      413,
      "This context is too large. Try a smaller selection.",
    );
}

export function parseBoardImage(
  value: unknown,
): { mimeType: string; data: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > MAX_IMAGE_BYTES + 64)
    throw new AiRequestError(413, "The board image is too large.");
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      value,
    );
  if (!match || match[2].length < 4 || match[2].length % 4 !== 0)
    throw new AiRequestError(400, "The board image is invalid.");
  return { mimeType: match[1], data: match[2] };
}

export function parseAiRequest(value: unknown): AiRequest {
  checkJson(value, MAX_REQUEST_BYTES);
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success)
    throw new AiRequestError(
      400,
      "The AI request is invalid. Refresh the context and try again.",
    );
  const body = parsed.data;
  const { boardImage, ...textContext } = body.context;
  checkJson(textContext, MAX_CONTEXT_BYTES);
  parseBoardImage(boardImage);
  if (body.messages.at(-1)?.role !== "user")
    throw new AiRequestError(
      400,
      "The request must end with the student's message.",
    );
  if (Boolean(body.continuation) !== Boolean(body.toolResults))
    throw new AiRequestError(
      400,
      "A tool continuation needs matching tool results.",
    );
  if (body.continuation && body.toolResults) {
    checkJson(body.continuation, MAX_CONTINUATION_BYTES);
    checkJson(body.toolResults, 192 * 1024);
    const last = body.continuation.contents.at(-1)!;
    const calls = last.parts.flatMap((part) =>
      part.functionCall ? [part.functionCall] : [],
    );
    if (
      last.role !== "model" ||
      calls.length !== body.toolResults.length ||
      calls.length === 0
    )
      throw new AiRequestError(
        400,
        "The tool results do not match this conversation.",
      );
    const remaining = [...body.toolResults];
    for (const call of calls) {
      const index = remaining.findIndex(
        (result) =>
          result.name === call.name && (!call.id || result.id === call.id),
      );
      if (index < 0)
        throw new AiRequestError(
          400,
          "The tool results do not match this conversation.",
        );
      remaining.splice(index, 1);
    }
  }
  return body;
}

export function validateOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    (fetchSite && fetchSite !== "same-origin")
  )
    throw new AiRequestError(
      403,
      "AI requests must come from this Ideate workspace.",
    );
}

export async function readAiRequest(request: Request): Promise<AiRequest> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new AiRequestError(415, "Send the AI request as JSON.");
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES)
    throw new AiRequestError(413, "The AI request is too large.");
  if (!request.body) throw new AiRequestError(400, "The AI request is empty.");
  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const stopReading = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", stopReading, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new AiRequestError(413, "The AI request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", stopReading);
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AiRequestError(400, "The AI request is not valid JSON.");
  }
  return parseAiRequest(parsed);
}

export function createRateLimiter(limit = 36, windowMs = 60_000) {
  let timestamps: number[] = [];
  return {
    take(now = Date.now()): boolean {
      timestamps = timestamps.filter((time) => time > now - windowMs);
      if (timestamps.length >= limit) return false;
      timestamps.push(now);
      return true;
    },
  };
}

export function mapAiError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof AiRequestError)
    return { status: error.status, message: error.message };
  const failure = error as { status?: number; name?: string } | null;
  if (failure?.name === "TimeoutError")
    return {
      status: 504,
      message: "Gemini took too long. Try again with a smaller request.",
    };
  if (failure?.name === "AbortError")
    return { status: 499, message: "The AI request was stopped." };
  if (failure?.status === 429)
    return {
      status: 429,
      message: "Gemini is at its usage limit. Wait a moment, then try again.",
    };
  if ([401, 403, 404].includes(failure?.status ?? 0))
    return {
      status: 503,
      message:
        "Gemini is unavailable. Check the server's API key and model configuration.",
    };
  if (failure?.status === 408 || failure?.status === 504)
    return { status: 504, message: "Gemini took too long. Please try again." };
  return {
    status: 502,
    message:
      "Gemini could not finish this request. Your workspace is safe; please try again.",
  };
}

export function continuationContents(body: AiRequest): Content[] | undefined {
  return body.continuation?.contents as Content[] | undefined;
}
