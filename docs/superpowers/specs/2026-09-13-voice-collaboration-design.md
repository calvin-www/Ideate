# Voice collaboration with progressive writing

## Approved experience

User amendment: interruption keeps the work already visible, including an unfinished function or partial stroke. It creates an undoable checkpoint and cancels future output. This supersedes the earlier discard-on-interruption design. Rendering/provider failures and conflicting manual edits still cancel stale previews without overwriting newer work.

The student starts a live voice session and talks to the existing Gemini study partner while using the board, Python editor, and notes. The partner speaks while drawing strokes or revealing editor lines. Speaking and writing belong to the same teaching step and play concurrently. An interruption pauses both; completed work survives, and the next response uses the student's clarification and the current workspace.

Use ElevenLabs for live transcription and speech synthesis. Keep Gemini and Ideate's existing context, proposal validation, undo, and Python execution rules. Do not introduce a separate conversational agent with separate memory. This design implements a first usable vertical slice, with sentence-level synchronization; precise word-level choreography is a later refinement.

## Interaction

- Start voice is an explicit microphone action. Show listening, thinking, speaking, and writing status, a partial transcript, mute, pause, and end controls. Keep text chat usable.
- A committed spoken utterance starts a collaborator request. Detect speech locally to stop output promptly, before waiting for transcription. Collect a complete utterance before dispatching its new request.
- A teaching step contains a short spoken explanation and optionally one existing workspace operation. Start its visible reveal when audio playback actually starts. Do not wait for speech to finish before writing. Finish the step only after both outputs complete.
- Text appears line by line at the destination. Board additions draw progressively along their paths, with labels appearing as each object completes. Avoid arbitrary slow typing of every character.
- Respect the existing Auto-apply changes setting. With it off, stage the existing review and play a change after acceptance; with it on, play validated edits directly. Starting voice never silently changes this setting.
- Pause cancels output immediately and saves the current visible text/board frame as an undoable checkpoint, after revalidating the already-approved proposal. Resume uses the unfinished writing task, retained partial work, and heard speech. A clarification can be answered without losing the unfinished task.
- Microphone mute stops transcription input and ends any partial utterance without submitting it. End releases tracks, audio, sockets, timers, and transient previews. Closing chat does not silently leave hidden microphone capture active: persistent voice controls stay visible at shell scope.

## Architecture

1. **Voice transport:** browser microphone capture with echo cancellation, streaming ElevenLabs Scribe transcription, local speech detection, and abortable ElevenLabs speech playback. Server routes issue short-lived transcription tokens and stream generated audio. API keys stay on the server.
2. **Teaching contract:** a validated `teach_step` tool pairs `speech` with an optional existing edit/attention operation. Speech-only steps use the same contract. The existing tool validation and operation executor remain authoritative.
3. **Playback coordinator:** owns a step's cancellation signal, actual audio-start event, concurrent presentation, and completion. Provider generation is sequential; output playback overlaps. No second writer or independently speaking model is required.
4. **Editor presentation:** temporary code/note text and board element previews reveal each approved step without publishing animation frames as persistent revisions. Applying the final validated proposal creates one normal undoable change. An intentional interruption checkpoints exactly the displayed partial edit and retires its animation.
5. **Session lifecycle:** shell-owned voice state routes utterances to the existing collaborator, cancels stale work before new requests, and keeps a short delivery record so unheard speech is not treated as delivered context.

## Data and invariants

- Existing workspace schema remains compatible. Audio and interim transcripts are not persisted. Final user utterances are normal messages.
- Keep one active mutation job. Every asynchronous callback checks a session/turn identity and its AbortSignal; late audio, transcripts, previews, and proposals cannot revive cancelled work.
- Preserve schema validation, exact revisions, accepted-operation deduplication, change history, and manual-edit conflict checks. Never execute streamed/incomplete tool arguments.
- A progressive preview is visibly provisional and excluded from saves, exports, screenshots used as model context, Python runs, and undo history. Manual input into a previewed artifact cancels the preview before applying the user's edit.
- Revalidate immediately before final commit. Preview completion never grants execution authorization. Python runs still require an explicit student request or the existing Apply & run control.
- Intentional interruption retires the animated preview after checkpointing the visible partial edit. Previously completed teaching steps remain committed. Stale or failed previews are discarded. Spoken delivery records distinguish completed sentences from interrupted speech.
- Use small steps: at most one artifact edit per teaching step. Each new model round receives the actual previous operation result. Avoid preparing an entire fixed lesson before playback.
- Use the browser audio clock to start the visual action; first version pacing may estimate sentence duration and must be measured with live speech. Do not claim frame-perfect synchronization or measured latency before testing it.

## Failure handling

Missing credentials produce actionable setup copy without asking for secrets in chat. Denied or missing microphones leave text collaboration functional. A dropped transcription connection ends listening and offers restart. A speech-generation/playback failure cancels that step's preview and reports the failure; do not apply silent edits under the appearance of a spoken explanation. Server routes bound request text, timeouts, and active work, validate origin for browser requests, and return sanitized errors. This app remains a local, loopback development app; public hosting requires authentication and per-user quotas first.

Reduced-motion mode reveals completed lines/objects without pen motion. Provide accessible button labels and a textual status; do not announce every animation frame. Hidden target editors offer existing navigation to reveal them without taking focus unexpectedly.

## Verification and first demonstration

Use deterministic transport fixtures to prove concurrent playback, cancellation during speech and writing, rejection of late events, persistence of only the displayed partial checkpoint, manual-edit preservation, revision conflicts, and exact final content. Exercise actual CodeMirror and Excalidraw in browser tests. Keep existing text-chat and edit-review tests passing.

The live demonstration asks for a small binary-search diagram, shows its midpoint calculation appearing line by line, then interrupts with a duplicate-values clarification. Verify audio and visual output stop together and the next response addresses the clarification. Measure end-of-utterance to first audio and interruption to silence/frozen pen; report measurements, not vendor inference-time claims. This requires a configured ElevenLabs key and accessible voice.

## References checked September 13, 2026

- [ElevenLabs client transcription](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming)
- [ElevenLabs speech WebSocket and timing](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)
- [ElevenLabs streaming speech](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming)
- [Current collaborator](../../../src/features/ai/useCollaborator.ts)
- [Existing AI contracts](../../ai-collaboration.md)
