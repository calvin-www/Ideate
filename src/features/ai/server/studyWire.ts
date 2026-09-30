import { z } from "zod";
import type { StudyCheckpoint } from "../contracts";
import { readRequestText, RequestBodyTooLargeError } from "../../http/server";
import {
  AiRequestError,
  MAX_CONTEXT_BYTES,
  MAX_CONTINUATION_BYTES,
  MAX_REQUEST_BYTES,
  checkJson,
  parseBoardImage,
} from "./validation";

const checkpointSchema = z.strictObject({
  token: z.string().uuid(),
  state: z.string().min(2).max(Math.ceil(MAX_CONTINUATION_BYTES * 4 / 3)).regex(/^[A-Za-z0-9_-]+$/),
});
const requestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("start"),
    messages: z.array(z.strictObject({
      role: z.enum(["user", "assistant"]),
      text: z.string().min(1).max(24 * 1024),
    })).min(1).max(8),
    context: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    type: z.literal("results"),
    checkpoint: checkpointSchema,
    results: z.array(z.strictObject({ id: z.string().min(1).max(200), result: z.unknown() })).min(1).max(12),
  }),
  z.strictObject({ type: z.literal("continue"), checkpoint: checkpointSchema }),
]);

export type StudyWireRequest = z.infer<typeof requestSchema>;
export type StudyWireCheckpoint = z.infer<typeof checkpointSchema>;

export function parseStudyRequest(value: unknown): StudyWireRequest {
  checkJson(value, MAX_REQUEST_BYTES);
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success)
    throw new AiRequestError(400, "The AI request is invalid. Refresh the context and try again.");
  const body = parsed.data;
  if (body.type === "start") {
    if (body.messages.at(-1)?.role !== "user")
      throw new AiRequestError(400, "The request must end with the student's message.");
    const { boardImage, ...textContext } = body.context;
    checkJson(textContext, MAX_CONTEXT_BYTES);
    parseBoardImage(boardImage);
  } else {
    // Validate serialized state before consuming the single-use token.
    decodeCheckpoint(body.checkpoint.state);
    if (body.type === "results") {
      checkJson(body.results, MAX_CONTEXT_BYTES);
      if (new Set(body.results.map((result) => result.id)).size !== body.results.length)
        throw new AiRequestError(400, "The operation results are invalid.");
    }
  }
  return body;
}

export function encodeCheckpoint(checkpoint: StudyCheckpoint): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(checkpoint);
  } catch {
    throw new AiRequestError(502, "Gemini returned an invalid continuation.");
  }
  if (!serialized || Buffer.byteLength(serialized) > MAX_CONTINUATION_BYTES)
    throw new AiRequestError(502, "Gemini returned too much data. Try a smaller request.");
  checkJson(JSON.parse(serialized), MAX_CONTINUATION_BYTES);
  return Buffer.from(serialized, "utf8").toString("base64url");
}

export function decodeCheckpoint(state: string): StudyCheckpoint {
  if (!/^[A-Za-z0-9_-]+$/.test(state) || state.length > Math.ceil(MAX_CONTINUATION_BYTES * 4 / 3))
    throw new AiRequestError(400, "The continuation is invalid.");
  const bytes = Buffer.from(state, "base64url");
  if (bytes.length > MAX_CONTINUATION_BYTES)
    throw new AiRequestError(413, "This conversation step is too large. Start a smaller request.");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new AiRequestError(400, "The continuation is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AiRequestError(400, "The continuation is invalid.");
  checkJson(value, MAX_CONTINUATION_BYTES);
  return value as StudyCheckpoint;
}

export async function readStudyRequest(request: Request): Promise<StudyWireRequest> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new AiRequestError(415, "Send the AI request as JSON.");
  let raw: string;
  try {
    raw = await readRequestText(request, MAX_REQUEST_BYTES, 10_000);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      throw new AiRequestError(413, "The AI request is too large.");
    throw error;
  }
  if (!request.body) throw new AiRequestError(400, "The AI request is empty.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AiRequestError(400, "The AI request is not valid JSON.");
  }
  return parseStudyRequest(value);
}
