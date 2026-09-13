import { describe, expect, it, vi } from "vitest";
import {
  handleVoiceSession,
  handleVoiceSpeech,
  MAX_SPEECH_TEXT_CHARS,
  type VoiceServerDependencies,
} from "../src/features/voice/server";

const origin = "http://localhost:3000";
const configured = {
  apiKey: "server-secret-key",
  voiceId: "voice/example",
  ttsModel: "eleven_flash_v2_5",
};

function post(path: string, body?: unknown, signal?: AbortSignal) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

function deps(
  fetchImpl: typeof fetch,
  config: VoiceServerDependencies["config"] = configured,
): VoiceServerDependencies {
  return { fetch: fetchImpl, config, timeoutMs: 1_000 };
}

describe("voice server boundary", () => {
  it("returns actionable setup errors without calling ElevenLabs", async () => {
    const upstream = vi.fn<typeof fetch>();

    const session = await handleVoiceSession(
      post("/api/voice/session"),
      deps(upstream, { apiKey: "", voiceId: "", ttsModel: "" }),
    );
    const speech = await handleVoiceSpeech(
      post("/api/voice/speech", { text: "Hello" }),
      deps(upstream, { apiKey: "", voiceId: "", ttsModel: "" }),
    );

    expect(session.status).toBe(503);
    expect(speech.status).toBe(503);
    expect(await session.json()).toEqual({
      error: "Voice service is not configured.",
    });
    expect(await speech.json()).toEqual({
      error: "Voice service is not configured.",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects malformed, empty, and oversized speech before the provider", async () => {
    const upstream = vi.fn<typeof fetch>();
    const malformed = new Request(`${origin}/api/voice/speech`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{",
    });

    expect((await handleVoiceSpeech(malformed, deps(upstream))).status).toBe(400);
    expect(
      (await handleVoiceSpeech(post("/api/voice/speech", { text: "  " }), deps(upstream)))
        .status,
    ).toBe(400);
    expect(
      (
        await handleVoiceSpeech(
          post("/api/voice/speech", {
            text: "x".repeat(MAX_SPEECH_TEXT_CHARS + 1),
          }),
          deps(upstream),
        )
      ).status,
    ).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["/api/voice/session", "/api/voice/speech"])(
    "rejects cross-origin browser requests to %s",
    async (path) => {
      const upstream = vi.fn<typeof fetch>();
      const request = new Request(`${origin}${path}`, {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
        body: path.endsWith("speech") ? JSON.stringify({ text: "Hello" }) : undefined,
      });

      const response = path.endsWith("speech")
        ? await handleVoiceSpeech(request, deps(upstream))
        : await handleVoiceSession(request, deps(upstream));

      expect(response.status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("accepts the browser origin when a proxy reconstructs a canonical URL", async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ token: "sutkn_example" }));
    const request = new Request("http://localhost:3000/api/voice/session", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });

    const response = await handleVoiceSession(request, deps(upstream));

    expect(response.status).toBe(200);
  });

  it("requests a realtime Scribe token with the server credential", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ token: "sutkn_example" }),
    );

    const response = await handleVoiceSession(
      post("/api/voice/session"),
      deps(upstream),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "sutkn_example" });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: { "xi-api-key": "server-secret-key" },
    });
  });

  it("streams 24 kHz PCM from the configured voice and model", async () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(pcm, {
        headers: { "content-type": "audio/pcm" },
      }),
    );

    const response = await handleVoiceSpeech(
      post("/api/voice/speech", { text: "  Explain the midpoint.  " }),
      deps(upstream),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/pcm");
    expect(response.headers.get("x-audio-sample-rate")).toBe("24000");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pcm);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice%2Fexample/stream?output_format=pcm_24000",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "Explain the midpoint.",
      model_id: "eleven_flash_v2_5",
    });
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "xi-api-key": "server-secret-key",
    });
  });

  it("propagates client cancellation to ElevenLabs", async () => {
    const requestController = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let started!: () => void;
    const upstreamStarted = new Promise<void>((resolve) => (started = resolve));
    const upstream = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      upstreamSignal = init?.signal ?? undefined;
      started();
      return new Promise((_resolve, reject) => {
        upstreamSignal?.addEventListener("abort", () => {
          reject(new DOMException("cancelled", "AbortError"));
        });
      });
    });
    const pending = handleVoiceSpeech(
      post("/api/voice/speech", { text: "Hello" }, requestController.signal),
      deps(upstream),
    );
    await upstreamStarted;

    requestController.abort();
    const response = await pending;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(response.status).toBe(499);
  });

  it.each([
    [
      "session",
      new Response("server-secret-key leaked", { status: 401 }),
      503,
      "Voice service credentials were rejected.",
    ],
    [
      "speech",
      new Response("server-secret-key leaked", { status: 500 }),
      502,
      "Voice provider request failed.",
    ],
  ] as const)("sanitizes %s upstream failures", async (kind, failure, status, error) => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(failure);
    const response =
      kind === "session"
        ? await handleVoiceSession(post("/api/voice/session"), deps(upstream))
        : await handleVoiceSpeech(
            post("/api/voice/speech", { text: "Hello" }),
            deps(upstream),
          );
    const body = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(body)).toEqual({ error });
    expect(body).not.toContain("server-secret-key");
    expect(body).not.toContain("ElevenLabs");
  });
});
