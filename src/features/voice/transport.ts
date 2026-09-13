"use client";

export type MicrophoneCallbacks = {
  onSpeechStart(): void;
  onPartial(text: string): void;
  onUtterance(text: string): void;
  onError(message: string): void;
};

export type MicrophoneConnection = {
  mute(value: boolean): void;
  close(): void;
};

type CaptureMessage = {
  type: "audio";
  pcm: ArrayBuffer;
  rms: number;
  durationMs: number;
};

const SCRIBE_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const SPEECH_RMS_THRESHOLD = 0.035;
const SPEECH_START_MS = 180;
const SPEECH_RESET_SILENCE_MS = 650;
let playbackContext: AudioContext | undefined;

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function audioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("Voice playback requires a browser.");
  }
  playbackContext ??= new AudioContext({ latencyHint: "interactive" });
  return playbackContext;
}

export async function unlockAudio(): Promise<void> {
  const context = audioContext();
  await context.resume();
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate);
  source.connect(context.destination);
  source.start();
  source.disconnect();
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function publicError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. You can keep using text chat.";
  }
  return fallback;
}

async function fetchScribeToken(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/voice/session", {
    method: "POST",
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    token?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof payload.token !== "string") {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not start transcription.",
    );
  }
  return payload.token;
}

export async function connectMicrophone(
  callbacks: MicrophoneCallbacks,
  signal: AbortSignal,
): Promise<MicrophoneConnection> {
  if (signal.aborted) throw abortError();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  let active = true;
  let muted = false;
  let generation = 0;
  let socket: WebSocket | undefined;
  let socketRequest: AbortController | undefined;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let capture: AudioWorkletNode | undefined;
  let silentOutput: GainNode | undefined;
  let loudMs = 0;
  let quietMs = 0;
  let speechActive = false;

  const resetDetector = () => {
    loudMs = 0;
    quietMs = 0;
    speechActive = false;
  };

  const close = () => {
    if (!active) return;
    active = false;
    generation += 1;
    signal.removeEventListener("abort", close);
    socketRequest?.abort();
    socketRequest = undefined;
    socket?.close();
    socket = undefined;
    capture?.port.postMessage({ type: "close" });
    capture?.port.close();
    capture?.disconnect();
    source?.disconnect();
    silentOutput?.disconnect();
    for (const track of stream?.getTracks() ?? []) track.stop();
    void context?.close();
  };

  const fail = (error: unknown, fallback: string) => {
    if (!active || signal.aborted) return;
    callbacks.onError(publicError(error, fallback));
    close();
  };

  const openSocket = async (): Promise<void> => {
    if (!active || muted || signal.aborted) return;
    const currentGeneration = ++generation;
    socketRequest?.abort();
    const requestController = new AbortController();
    socketRequest = requestController;
    const onAbort = () => requestController.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const token = await fetchScribeToken(requestController.signal);
      if (
        !active ||
        muted ||
        signal.aborted ||
        currentGeneration !== generation
      ) {
        return;
      }
      const url = new URL(SCRIBE_URL);
      url.searchParams.set("model_id", "scribe_v2_realtime");
      url.searchParams.set("token", token);
      url.searchParams.set("audio_format", "pcm_16000");
      url.searchParams.set("commit_strategy", "vad");
      url.searchParams.set("vad_silence_threshold_secs", "1.0");
      url.searchParams.set("min_speech_duration_ms", "250");
      url.searchParams.set("min_silence_duration_ms", "800");
      const nextSocket = new WebSocket(url);
      socket = nextSocket;
      await new Promise<void>((resolve, reject) => {
        const rejectOpen = () => reject(new Error("Transcription connection failed."));
        nextSocket.addEventListener("open", () => resolve(), { once: true });
        nextSocket.addEventListener("error", rejectOpen, { once: true });
        nextSocket.addEventListener("close", rejectOpen, { once: true });
      });
      if (currentGeneration !== generation || !active || muted) {
        nextSocket.close();
        return;
      }
      nextSocket.onmessage = (event) => {
        if (
          currentGeneration !== generation ||
          !active ||
          muted ||
          signal.aborted
        ) {
          return;
        }
        let message: { message_type?: unknown; text?: unknown };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (
          message.message_type === "partial_transcript" &&
          typeof message.text === "string"
        ) {
          callbacks.onPartial(message.text);
        } else if (
          message.message_type === "committed_transcript" &&
          typeof message.text === "string"
        ) {
          const text = message.text.trim();
          callbacks.onPartial("");
          if (text) callbacks.onUtterance(text);
        } else if (
          typeof message.message_type === "string" &&
          ["auth_error", "error", "input_error", "quota_exceeded", "rate_limited"].includes(
            message.message_type,
          )
        ) {
          fail(undefined, "Transcription stopped. Start voice again.");
        }
      };
      nextSocket.onclose = () => {
        if (
          active &&
          !muted &&
          !signal.aborted &&
          currentGeneration === generation
        ) {
          fail(undefined, "Transcription connection closed. Start voice again.");
        }
      };
      nextSocket.onerror = () => {
        if (currentGeneration === generation) {
          fail(undefined, "Transcription connection failed. Start voice again.");
        }
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (socketRequest === requestController) socketRequest = undefined;
    }
  };

  signal.addEventListener("abort", close, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    if (!active || signal.aborted) {
      for (const track of stream.getTracks()) track.stop();
      throw abortError();
    }
    context = new AudioContext({ latencyHint: "interactive", sampleRate: 16_000 });
    await context.audioWorklet.addModule("/voice-capture.js");
    if (!active || signal.aborted) throw abortError();
    source = context.createMediaStreamSource(stream);
    capture = new AudioWorkletNode(context, "voice-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    source.connect(capture);
    capture.connect(silentOutput).connect(context.destination);
    capture.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
      if (
        event.data?.type !== "audio" ||
        !active ||
        muted ||
        signal.aborted
      ) {
        return;
      }
      const { durationMs, rms, pcm } = event.data;
      if (rms >= SPEECH_RMS_THRESHOLD) {
        loudMs += durationMs;
        quietMs = 0;
        if (!speechActive && loudMs >= SPEECH_START_MS) {
          speechActive = true;
          callbacks.onSpeechStart();
        }
      } else {
        loudMs = Math.max(0, loudMs - durationMs * 2);
        if (speechActive) {
          quietMs += durationMs;
          if (quietMs >= SPEECH_RESET_SILENCE_MS) resetDetector();
        }
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: bytesToBase64(pcm),
          }),
        );
      }
    };
    await context.resume();
    await openSocket();
  } catch (error) {
    if (active && !signal.aborted) {
      callbacks.onError(publicError(error, "Could not start voice input."));
    }
    close();
    throw error;
  }

  return {
    mute(value: boolean) {
      if (!active || muted === value) return;
      muted = value;
      resetDetector();
      callbacks.onPartial("");
      capture?.port.postMessage({ type: "mute", value });
      generation += 1;
      socketRequest?.abort();
      socket?.close();
      socket = undefined;
      if (!value) {
        void openSocket().catch((error) => {
          fail(error, "Could not restart transcription.");
        });
      }
    },
    close,
  };
}

function pcmSamples(
  chunk: Uint8Array,
  carry: number | undefined,
): { samples: Float32Array; carry: number | undefined } {
  const byteLength = chunk.byteLength + (carry === undefined ? 0 : 1);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  if (carry !== undefined) {
    bytes[0] = carry;
    offset = 1;
  }
  bytes.set(chunk, offset);
  const usable = bytes.byteLength - (bytes.byteLength % 2);
  const samples = new Float32Array(usable / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return {
    samples,
    carry: usable < bytes.byteLength ? bytes[bytes.byteLength - 1] : undefined,
  };
}

export async function speak(
  text: string,
  signal: AbortSignal,
  onStart: () => void,
): Promise<void> {
  if (signal.aborted) throw abortError();
  const context = audioContext();
  await context.resume();
  if (signal.aborted) throw abortError();

  const sources = new Set<AudioBufferSourceNode>();
  const completions: Promise<void>[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => {
    void reader?.cancel().catch(() => undefined);
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // A source that already ended has nothing left to stop.
      }
      source.disconnect();
    }
    sources.clear();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const response = await fetch("/api/voice/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      throw new Error(
        typeof payload.error === "string"
          ? payload.error
          : "Speech playback could not start.",
      );
    }
    const sampleRate = Number(response.headers.get("x-audio-sample-rate"));
    if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
      throw new Error("Speech response had an invalid sample rate.");
    }

    reader = response.body.getReader();
    let carry: number | undefined;
    let playhead = context.currentTime;
    let started = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw abortError();
      const decoded = pcmSamples(value, carry);
      carry = decoded.carry;
      if (!decoded.samples.length) continue;
      const buffer = context.createBuffer(1, decoded.samples.length, sampleRate);
      buffer.getChannelData(0).set(decoded.samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      sources.add(source);
      const ended = new Promise<void>((resolve) => {
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
          resolve();
        };
      });
      completions.push(ended);
      const startAt = Math.max(playhead, context.currentTime);
      if (!started) {
        started = true;
        onStart();
      }
      source.start(startAt);
      playhead = startAt + buffer.duration;
    }
    if (!started || carry !== undefined) {
      throw new Error("Speech response did not contain valid PCM audio.");
    }
    await Promise.all(completions);
    if (signal.aborted) throw abortError();
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (signal.aborted) cancel();
  }
}
