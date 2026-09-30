import {
  errorResponse,
  InvalidCredentialError,
  isTrustedOrigin,
  readCredential,
  readRequestText,
  RequestBodyTooLargeError,
} from "../http/server";

const ELEVENLABS_ORIGIN = "https://api.elevenlabs.io";
const SCRIBE_TOKEN_URL = `${ELEVENLABS_ORIGIN}/v1/single-use-token/realtime_scribe`;
const PCM_SAMPLE_RATE = 24_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_SPEECH = 4;
const MAX_REQUEST_BYTES = 24 * 1024;
const MAX_TOKEN_RESPONSE_BYTES = 8 * 1024;

export const MAX_SPEECH_TEXT_CHARS = 5_000;

export type VoiceServerConfig = {
  apiKey: string;
  voiceId: string;
  ttsModel: string;
};

export type VoiceServerDependencies = {
  fetch?: typeof fetch;
  config?: VoiceServerConfig;
  timeoutMs?: number;
  maxAudioBytes?: number;
  maxConcurrentSpeech?: number;
};

let activeSpeechRequests = 0;

type AbortLink = {
  controller: AbortController;
  didTimeout(): boolean;
  cleanup(): void;
};

const SETUP_MESSAGE =
  "Add your ElevenLabs API key and voice ID in Settings to use voice.";

/** Visitor credentials arrive per request; the server keeps none. */
export function requestConfig(request: Request): VoiceServerConfig | null {
  const apiKey = readCredential(request, "X-ElevenLabs-Key");
  const voiceId = readCredential(request, "X-ElevenLabs-Voice");
  if (!apiKey || !voiceId) return null;
  return {
    apiKey,
    voiceId,
    ttsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
  };
}

function configuredVoice(
  request: Request,
  override: VoiceServerConfig | undefined,
  needsModel = false,
): VoiceServerConfig | Response {
  try {
    const config = override ?? requestConfig(request);
    if (!config?.apiKey || !config.voiceId || (needsModel && !config.ttsModel)) {
      return errorResponse(503, SETUP_MESSAGE);
    }
    return config;
  } catch (error) {
    if (error instanceof InvalidCredentialError)
      return errorResponse(400, error.message);
    throw error;
  }
}

function linkAbort(request: Request, timeoutMs: number): AbortLink {
  const controller = new AbortController();
  let timedOut = false;
  const onRequestAbort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) onRequestAbort();
  else request.signal.addEventListener("abort", onRequestAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    controller,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onRequestAbort);
    },
  };
}

function mappedFetchError(request: Request, link: AbortLink): Response {
  if (request.signal.aborted) return errorResponse(499, "Request cancelled.");
  if (link.didTimeout()) return errorResponse(504, "Voice provider timed out.");
  return errorResponse(502, "Voice provider request failed.");
}

function upstreamError(response: Response): Response {
  if (response.status === 401 || response.status === 403) {
    return errorResponse(503, "Voice service credentials were rejected.");
  }
  if (response.status === 429) {
    return errorResponse(429, "Voice service is busy. Try again shortly.");
  }
  return errorResponse(502, "Voice provider request failed.");
}

async function readLimitedText(
  response: Response,
  limit: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new Error("Response too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

async function readSpeechText(request: Request, timeoutMs: number): Promise<
  | { text: string }
  | { response: Response }
> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { response: errorResponse(415, "Expected a JSON request.") };
  }
  let raw: string;
  try {
    raw = await readRequestText(request, MAX_REQUEST_BYTES, timeoutMs);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return { response: errorResponse(413, "Speech text is too long.") };
    if (request.signal.aborted)
      return { response: errorResponse(499, "Request cancelled.") };
    if (error instanceof DOMException && error.name === "TimeoutError")
      return { response: errorResponse(504, "Speech request timed out.") };
    return { response: errorResponse(400, "Invalid speech request.") };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { response: errorResponse(400, "Invalid speech request.") };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { text?: unknown }).text !== "string"
  ) {
    return { response: errorResponse(400, "Invalid speech request.") };
  }
  const text = (parsed as { text: string }).text.trim();
  if (!text) return { response: errorResponse(400, "Invalid speech request.") };
  if (text.length > MAX_SPEECH_TEXT_CHARS) {
    return { response: errorResponse(413, "Speech text is too long.") };
  }
  return { text };
}

export async function handleVoiceSession(
  request: Request,
  dependencies: VoiceServerDependencies = {},
): Promise<Response> {
  if (!isTrustedOrigin(request)) {
    return errorResponse(403, "Request origin is not allowed.");
  }
  const config = configuredVoice(request, dependencies.config);
  if (config instanceof Response) return config;
  const fetchImpl = dependencies.fetch ?? fetch;
  const link = linkAbort(request, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(SCRIBE_TOKEN_URL, {
      method: "POST",
      headers: { "xi-api-key": config.apiKey },
      signal: link.controller.signal,
    });
    if (!response.ok) return upstreamError(response);
    const raw = await readLimitedText(response, MAX_TOKEN_RESPONSE_BYTES);
    const payload = JSON.parse(raw) as { token?: unknown };
    if (typeof payload.token !== "string" || !payload.token) {
      return errorResponse(502, "Voice provider request failed.");
    }
    return Response.json(
      { token: payload.token },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return mappedFetchError(request, link);
  } finally {
    link.cleanup();
  }
}

function boundedAudioStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  link: AbortLink,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let size = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          link.cleanup();
          release();
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > maxBytes) {
          link.controller.abort();
          await reader.cancel();
          link.cleanup();
          release();
          controller.error(new Error("Audio response exceeded its limit"));
          return;
        }
        controller.enqueue(value);
      } catch {
        link.cleanup();
        release();
        controller.error(new Error("Audio stream failed"));
      }
    },
    async cancel(reason) {
      link.controller.abort(reason);
      link.cleanup();
      release();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

export async function handleVoiceSpeech(
  request: Request,
  dependencies: VoiceServerDependencies = {},
): Promise<Response> {
  if (!isTrustedOrigin(request)) {
    return errorResponse(403, "Request origin is not allowed.");
  }
  const config = configuredVoice(request, dependencies.config, true);
  if (config instanceof Response) return config;
  const input = await readSpeechText(request, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if ("response" in input) return input.response;

  const maxConcurrentSpeech =
    dependencies.maxConcurrentSpeech ?? DEFAULT_MAX_CONCURRENT_SPEECH;
  if (activeSpeechRequests >= maxConcurrentSpeech) {
    return errorResponse(503, "Voice service is busy. Try again shortly.");
  }
  activeSpeechRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeSpeechRequests -= 1;
  };

  const link = linkAbort(request, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const fetchImpl = dependencies.fetch ?? fetch;
  try {
    const url = `${ELEVENLABS_ORIGIN}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?output_format=pcm_24000`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": config.apiKey,
      },
      body: JSON.stringify({ text: input.text, model_id: config.ttsModel }),
      signal: link.controller.signal,
    });
    if (!response.ok || !response.body) {
      link.cleanup();
      release();
      return response.ok
        ? errorResponse(502, "Voice provider request failed.")
        : upstreamError(response);
    }
    const maxBytes = dependencies.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      link.controller.abort();
      link.cleanup();
      release();
      await response.body.cancel().catch(() => undefined);
      return errorResponse(502, "Voice provider response was too large.");
    }
    return new Response(boundedAudioStream(response.body, maxBytes, link, release), {
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/pcm",
        "x-audio-sample-rate": String(PCM_SAMPLE_RATE),
      },
    });
  } catch {
    link.cleanup();
    release();
    return mappedFetchError(request, link);
  }
}
