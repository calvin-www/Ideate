const ELEVENLABS_ORIGIN = "https://api.elevenlabs.io";
const SCRIBE_TOKEN_URL = `${ELEVENLABS_ORIGIN}/v1/single-use-token/realtime_scribe`;
const PCM_SAMPLE_RATE = 24_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_AUDIO_BYTES = 12 * 1024 * 1024;
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
};

type AbortLink = {
  controller: AbortController;
  didTimeout(): boolean;
  cleanup(): void;
};

function jsonError(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function environmentConfig(): VoiceServerConfig {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY?.trim() ?? "",
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() ?? "",
    ttsModel:
      process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
  };
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
  if (request.signal.aborted) return jsonError(499, "Request cancelled.");
  if (link.didTimeout()) return jsonError(504, "Voice provider timed out.");
  return jsonError(502, "Voice provider request failed.");
}

function upstreamError(response: Response): Response {
  if (response.status === 401 || response.status === 403) {
    return jsonError(503, "Voice service credentials were rejected.");
  }
  if (response.status === 429) {
    return jsonError(429, "Voice service is busy. Try again shortly.");
  }
  return jsonError(502, "Voice provider request failed.");
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

async function readSpeechText(request: Request): Promise<
  | { text: string }
  | { response: Response }
> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { response: jsonError(415, "Expected a JSON request.") };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return { response: jsonError(413, "Speech text is too long.") };
  }
  let raw: string;
  try {
    raw = await readLimitedText(new Response(request.body), MAX_REQUEST_BYTES);
  } catch {
    return { response: jsonError(413, "Speech text is too long.") };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { response: jsonError(400, "Invalid speech request.") };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { text?: unknown }).text !== "string"
  ) {
    return { response: jsonError(400, "Invalid speech request.") };
  }
  const text = (parsed as { text: string }).text.trim();
  if (!text) return { response: jsonError(400, "Invalid speech request.") };
  if (text.length > MAX_SPEECH_TEXT_CHARS) {
    return { response: jsonError(413, "Speech text is too long.") };
  }
  return { text };
}

export async function handleVoiceSession(
  request: Request,
  dependencies: VoiceServerDependencies = {},
): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return jsonError(403, "Request origin is not allowed.");
  }
  const config = dependencies.config ?? environmentConfig();
  if (!config.apiKey) {
    return jsonError(503, "Voice service is not configured.");
  }
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
      return jsonError(502, "Voice provider request failed.");
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
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let size = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          link.cleanup();
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > maxBytes) {
          link.controller.abort();
          await reader.cancel();
          link.cleanup();
          controller.error(new Error("Audio response exceeded its limit"));
          return;
        }
        controller.enqueue(value);
      } catch {
        link.cleanup();
        controller.error(new Error("Audio stream failed"));
      }
    },
    async cancel(reason) {
      link.controller.abort(reason);
      link.cleanup();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

export async function handleVoiceSpeech(
  request: Request,
  dependencies: VoiceServerDependencies = {},
): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return jsonError(403, "Request origin is not allowed.");
  }
  const config = dependencies.config ?? environmentConfig();
  if (!config.apiKey || !config.voiceId || !config.ttsModel) {
    return jsonError(503, "Voice service is not configured.");
  }
  const input = await readSpeechText(request);
  if ("response" in input) return input.response;

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
      return response.ok
        ? jsonError(502, "Voice provider request failed.")
        : upstreamError(response);
    }
    const maxBytes = dependencies.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      link.controller.abort();
      link.cleanup();
      await response.body.cancel().catch(() => undefined);
      return jsonError(502, "Voice provider response was too large.");
    }
    return new Response(boundedAudioStream(response.body, maxBytes, link), {
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/pcm",
        "x-audio-sample-rate": String(PCM_SAMPLE_RATE),
      },
    });
  } catch {
    link.cleanup();
    return mappedFetchError(request, link);
  }
}
