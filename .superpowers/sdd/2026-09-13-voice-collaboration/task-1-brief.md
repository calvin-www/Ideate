## Task 1: ElevenLabs transport

**Files:** Create `src/features/voice/server.ts`, `src/app/api/voice/session/route.ts`, `src/app/api/voice/speech/route.ts`, `src/features/voice/transport.ts`, `public/voice-capture.js`, and `tests/voice-server.test.ts`. Modify `.env.example` only to append voice settings.

**Interfaces:** Export `connectMicrophone({onSpeechStart, onPartial, onUtterance, onError}, signal): Promise<{mute(value:boolean):void; close():void}>` and `speak(text, signal, onStart): Promise<void>`. Speech starts invoke `onStart` once, immediately before actual first audio playback. Completion means playback, not download completion. Microphone close must synchronously release recording resources. Server exposes POST `/api/voice/session` returning a Scribe token and POST `/api/voice/speech` accepting `{text}` and returning streaming PCM audio at a documented sample rate.

- [ ] Write request tests for missing configuration, invalid/oversized input, origin rejection, cancellation, and sanitized upstream failure. Use injected fetch/config; assert response status and body and actual upstream URL/body.
- [ ] Run `npx vitest run tests/voice-server.test.ts` and confirm the missing behavior fails.
- [ ] Implement server handlers using fixed ElevenLabs hosts, bounded requests, server-only credentials, and streamed audio. Verify current endpoint contracts against official documentation.
- [ ] Implement microphone capture, short audio frames, local voice activity interruption, Scribe partial/final events, mute and complete cleanup. Guard late events by the signal.
- [ ] Implement audio playback with abortable fetch and audio buffers, an actual-playback start callback, and completion after the last sample. Stop and discard queued buffers on abort.
- [ ] Run focused tests and typecheck. Document environment names and any live limitations.

