# Task 1 report: ElevenLabs transport

## Public browser API

```ts
type MicrophoneCallbacks = {
  onSpeechStart(): void;
  onPartial(text: string): void;
  onUtterance(text: string): void;
  onError(message: string): void;
};

type MicrophoneConnection = {
  mute(value: boolean): void;
  close(): void;
};

unlockAudio(): Promise<void>;

closeAudio(): Promise<void>;

connectMicrophone(
  callbacks: MicrophoneCallbacks,
  signal: AbortSignal,
): Promise<MicrophoneConnection>;

speak(
  text: string,
  signal: AbortSignal,
  onStart: () => void,
): Promise<void>;
```

Call `unlockAudio()` directly from the Start voice user gesture. `closeAudio()` clears the shared playback-context reference before awaiting browser shutdown, so a later Start can create a new context without racing the old close. `speak` calls `onStart` exactly once, immediately before starting the first decoded PCM buffer, and resolves only after all scheduled buffers end. Aborting rejects independently of browser `onended` events, stops and disconnects every scheduled source, cancels the reader, and aborts the fetch. A PCM read failure also aborts that fetch.

`connectMicrophone` requests one echo-cancelled, noise-suppressed mono track. Its `close()` synchronously stops all media tracks, disconnects the audio graph, closes the worklet port and WebSocket, and begins closing the recording `AudioContext`. `mute(true)` clears partial UI, stops worklet input, closes the Scribe socket, and discards that socket's late events. `mute(false)` obtains a new single-use token and opens a fresh Scribe session. Muting again while that token or socket is pending is treated as intentional cancellation and does not close the microphone or report an error. A Scribe socket that does not open within eight seconds is closed and reported as a controlled transport error.

The capture worklet emits 20 ms, 16 kHz signed PCM frames. The local interruption callback requires at least 180 ms of sustained RMS at or above 0.035, then rearms after 650 ms of quiet. Scribe uses VAD commits with a 1.0 second silence threshold, 250 ms minimum speech, and 800 ms minimum silence so short natural pauses stay in one utterance.

## Server API

```ts
handleVoiceSession(
  request: Request,
  dependencies?: VoiceServerDependencies,
): Promise<Response>;

handleVoiceSpeech(
  request: Request,
  dependencies?: VoiceServerDependencies,
): Promise<Response>;

type VoiceServerDependencies = {
  fetch?: typeof fetch;
  config?: {
    apiKey: string;
    voiceId: string;
    ttsModel: string;
  };
  timeoutMs?: number;
  maxAudioBytes?: number;
  maxConcurrentSpeech?: number;
};
```

`POST /api/voice/session` returns `{ "token": string }`. It calls the fixed official endpoint `https://api.elevenlabs.io/v1/single-use-token/realtime_scribe` and never returns the API key.

`POST /api/voice/speech` accepts `{ "text": string }` and streams signed 16-bit little-endian PCM with `Content-Type: audio/pcm` and `X-Audio-Sample-Rate: 24000`. It calls `https://api.elevenlabs.io/v1/text-to-speech/:voice_id/stream?output_format=pcm_24000` with `{ text, model_id }`.

Both routes require a same-origin browser `Origin`; the comparison accepts the route URL origin or the adapter's `Host` plus forwarded protocol. Defaults are a 20 second upstream timeout, 5,000 text characters, a 24 KiB JSON body, a 12 MiB audio stream, an 8 KiB token response, and four active speech streams. Client disconnects abort upstream work. Failures contain controlled messages only; rejected credentials are distinguished from missing setup, rate limits, timeouts, cancellation, and generic provider failures.

## Environment

```dotenv
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_chosen_voice_id
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
```

The model defaults to `eleven_flash_v2_5` when the variable is omitted. Session startup checks both the API key and voice ID before issuing a Scribe token, so an incomplete speech setup fails before Scribe connects.

## Verification and live limits

- `npx vitest run tests/voice-server.test.ts`: 15 tests passed, including browser API fixtures for playback abort, upstream stream failure, and the mute/unmute race.
- Focused strict TypeScript check for `server.ts` and `transport.ts`: passed.
- `npm run typecheck`: passed.
- `npm test`: 26 files and 213 tests passed.
- Live local route check with the configured account: Scribe token returned HTTP 200; `Ready.` returned HTTP 200, `audio/pcm`, 24 kHz, and 33,436 bytes. No credential or voice identifier was printed.

Live microphone capture and audible playback still require a browser user gesture and microphone permission. The local RMS threshold is an initial noise guard and needs measurement on the demonstration hardware; browser echo cancellation and input gain vary. Audio start/interrupt latency has not been measured yet, and playback synchronization is buffer-level rather than frame-perfect.
