import { describe, expect, it, vi } from "vitest";
import {
  handleVoiceSession,
  handleVoiceSpeech,
  MAX_SPEECH_TEXT_CHARS,
  type VoiceServerDependencies,
} from "../src/features/voice/server";
import {
  closeAudio,
  connectMicrophone,
  speak,
} from "../src/features/voice/transport";

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
      error: "Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env.local, then restart the server.",
    });
    expect(await speech.json()).toEqual({
      error: "Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env.local, then restart the server.",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects session startup before issuing a token when the voice is missing", async () => {
    const upstream = vi.fn<typeof fetch>();

    const response = await handleVoiceSession(
      post("/api/voice/session"),
      deps(upstream, { ...configured, voiceId: "" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env.local, then restart the server.",
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

  it("bounds concurrent speech generation until its stream is released", async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new ReadableStream<Uint8Array>()));
    const limited = {
      ...deps(upstream),
      maxConcurrentSpeech: 1,
    };

    const first = await handleVoiceSpeech(
      post("/api/voice/speech", { text: "First" }),
      limited,
    );
    const second = await handleVoiceSpeech(
      post("/api/voice/speech", { text: "Second" }),
      limited,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
    await first.body?.cancel();
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

class FakeSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakePort {
  onmessage: ((event: MessageEvent<CaptureMessage>) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
}

type CaptureMessage = {
  type: "audio";
  pcm: ArrayBuffer;
  rms: number;
  durationMs: number;
};

function installAudioBrowser() {
  const sources: FakeSource[] = [];
  const track = { stop: vi.fn() };
  class FakeNode {
    port = new FakePort();
    gain = { value: 1 };
    connect(target: unknown) {
      return target;
    }
    disconnect() {}
  }
  class FakeContext {
    currentTime = 0;
    destination = {};
    sampleRate = 48_000;
    state: AudioContextState = "running";
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    createBuffer(_channels: number, length: number, rate: number) {
      const samples = new Float32Array(length);
      return {
        duration: length / rate,
        getChannelData: () => samples,
      };
    }
    createBufferSource() {
      const source = new FakeSource();
      sources.push(source);
      return source;
    }
    createMediaStreamSource() {
      return new FakeNode();
    }
    createGain() {
      return new FakeNode();
    }
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockImplementation(async () => {
      this.state = "closed";
    });
  }
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeNode);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }),
    },
  });
  return { sources, track };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(_url: URL) {
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    });
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(_value: string) {}

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
    this.onclose?.();
  }

  private emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe("voice browser transport", () => {
  it("settles promptly on abort even when stopped sources never emit ended", async () => {
    const { sources } = installAudioBrowser();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array([0, 0, 1, 0]), {
          headers: { "x-audio-sample-rate": "24000" },
        }),
      ),
    );
    const controller = new AbortController();
    let started!: () => void;
    const playbackStarted = new Promise<void>((resolve) => (started = resolve));
    const pending = speak("Hello", controller.signal, started);
    await playbackStarted;

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sources[0].stop).toHaveBeenCalled();
    await closeAudio();
    vi.unstubAllGlobals();
  });

  it("aborts the upstream request when reading its PCM stream fails", async () => {
    const { sources } = installAudioBrowser();
    let upstreamAborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((_url, init) => {
        init?.signal?.addEventListener("abort", () => {
          upstreamAborted = true;
        });
        let pulled = false;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!pulled) {
                  pulled = true;
                  controller.enqueue(new Uint8Array([0, 0]));
                } else {
                  controller.error(new Error("broken PCM stream"));
                }
              },
            }),
            { headers: { "x-audio-sample-rate": "24000" } },
          ),
        );
      }),
    );

    await expect(
      speak("Hello", new AbortController().signal, () => undefined),
    ).rejects.toThrow("broken PCM stream");
    expect(upstreamAborted).toBe(true);
    expect(sources[0].stop).toHaveBeenCalled();
    await closeAudio();
    vi.unstubAllGlobals();
  });

  it("does not fail the microphone when muting an in-flight unmute", async () => {
    const { track } = installAudioBrowser();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    let tokenRequest = 0;
    let replacementAborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((_url, init) => {
        tokenRequest += 1;
        if (tokenRequest === 1) {
          return Promise.resolve(Response.json({ token: "sutkn_first" }));
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            replacementAborted = true;
            reject(new DOMException("cancelled", "AbortError"));
          });
        });
      }),
    );
    const errors: string[] = [];
    const microphone = await connectMicrophone(
      {
        onSpeechStart: () => undefined,
        onPartial: () => undefined,
        onUtterance: () => undefined,
        onError: (message) => errors.push(message),
      },
      new AbortController().signal,
    );

    microphone.mute(true);
    microphone.mute(false);
    microphone.mute(true);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(replacementAborted).toBe(true);
    expect(errors).toEqual([]);
    expect(track.stop).not.toHaveBeenCalled();
    microphone.close();
    expect(track.stop).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
