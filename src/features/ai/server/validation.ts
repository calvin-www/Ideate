import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { CREDENTIAL_PATTERN, InvalidCredentialError, isTrustedOrigin, readCredential } from "../../http/server";

export const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
export const MAX_CONTEXT_BYTES = 192 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_CONTINUATION_BYTES = 4 * 1024 * 1024;
export const MAX_CONTINUATION_PART_CHARS = 128 * 1024;

export class AiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AiRequestError";
  }
}

export function checkJson(value: unknown, maxBytes: number): void {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let entries = 0;
  while (queue.length) {
    const current = queue.pop()!;
    if (++entries > 75_000 || current.depth > 24)
      throw new AiRequestError(413, "This context is too complex. Try a smaller selection.");
    if (current.value !== null && typeof current.value === "object") {
      for (const item of Object.values(current.value))
        queue.push({ value: item, depth: current.depth + 1 });
    } else if (current.value === undefined ||
      (typeof current.value === "number" && !Number.isFinite(current.value))) {
      throw new AiRequestError(400, "The request contains invalid data.");
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes)
    throw new AiRequestError(413, "This context is too large. Try a smaller selection.");
}

export function parseBoardImage(value: unknown): { mimeType: string; data: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > MAX_IMAGE_BYTES + 64)
    throw new AiRequestError(413, "The board image is too large.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length < 4 || match[2].length % 4 !== 0)
    throw new AiRequestError(400, "The board image is invalid.");
  return { mimeType: match[1], data: match[2] };
}

export const PROVIDER_KEY_PATTERN = CREDENTIAL_PATTERN;

export function readProviderKey(request: Request, header: string): string | undefined {
  try {
    return readCredential(request, header);
  } catch (error) {
    if (error instanceof InvalidCredentialError)
      throw new AiRequestError(400, `The ${header} header is not a valid API key.`);
    throw error;
  }
}

export function validateOrigin(request: Request): void {
  if (!isTrustedOrigin(request))
    throw new AiRequestError(403, "AI requests must come from this Ideate workspace.");
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

export type VisitorLimiter = { take(identity: string): Promise<boolean> };

// Vercel replaces X-Forwarded-For at its edge. An absent address shares one
// conservative bucket; never accept a browser-supplied visitor identifier.
export function visitorIdentity(request: Request): string {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  return createHash("sha256").update(address.slice(0, 128)).digest("hex");
}

export function createVisitorLimiter(limit = 36, windowMs = 60_000): VisitorLimiter {
  const visitors = new Map<string, ReturnType<typeof createRateLimiter>>();
  return {
    async take(identity) {
      let limiter = visitors.get(identity);
      if (!limiter) {
        if (visitors.size >= 1000) visitors.delete(visitors.keys().next().value!);
        limiter = createRateLimiter(limit, windowMs);
        visitors.set(identity, limiter);
      }
      return limiter.take();
    },
  };
}

export function createSharedVisitorLimiter(
  backend: { limit(identity: string): Promise<{ success: boolean; reason?: string }> },
): VisitorLimiter {
  return {
    async take(identity) {
      try {
        const result = await backend.limit(identity);
        if (result.reason === "timeout") throw new Error("Visitor throttling timed out");
        return result.success;
      } catch {
        throw new AiRequestError(503, "Visitor throttling is unavailable. Try again shortly.");
      }
    },
  };
}

const localVisitorLimiter = createVisitorLimiter();
let sharedVisitorLimiter: VisitorLimiter | undefined;

export function configuredVisitorLimiter(): VisitorLimiter {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV !== "production" && !url && !token) return localVisitorLimiter;
    throw new AiRequestError(503, "Visitor throttling is not configured.");
  }
  if (!sharedVisitorLimiter) {
    sharedVisitorLimiter = createSharedVisitorLimiter(new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(36, "1 m"),
      prefix: "ideate:ai:visitor",
      timeout: 3000,
    }));
  }
  return sharedVisitorLimiter;
}

export function mapAiError(error: unknown): { status: number; message: string } {
  if (error instanceof AiRequestError)
    return { status: error.status, message: error.message };
  const failure = error as { status?: number; name?: string } | null;
  if (failure?.name === "TimeoutError")
    return { status: 504, message: "Gemini took too long. Try again with a smaller request." };
  if (failure?.name === "AbortError")
    return { status: 499, message: "The AI request was stopped." };
  if (failure?.status === 429)
    return { status: 429, message: "Gemini is at its usage limit. Wait a moment, then try again." };
  if ([401, 403, 404].includes(failure?.status ?? 0))
    return { status: 503, message: "Gemini is unavailable. Check the server's API key and model configuration." };
  if (failure?.status === 408 || failure?.status === 504)
    return { status: 504, message: "Gemini took too long. Please try again." };
  return { status: 502, message: "Gemini could not finish this request. Your workspace is safe; please try again." };
}
