# Voice Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** A first live voice session in which Gemini speaks through ElevenLabs while reversible workspace edits appear progressively, and interruptions stop both outputs.

**Architecture:** Retain the existing collaborator and proposal executor. Add a paired teaching-step tool, an abortable speech/microphone transport, and ephemeral editor previews coordinated by a shell-owned session.

**Tech Stack:** Existing Next.js 16.3.5, React 19, TypeScript, Zustand, CodeMirror, Excalidraw, Gemini SDK; ElevenLabs HTTP/WebSocket APIs and browser Web Audio.

**Spec:** `docs/superpowers/specs/2026-09-13-voice-collaboration-design.md`

## Global constraints

- API keys stay on the server.
- Keep one active mutation job.
- Never execute streamed/incomplete tool arguments.
- Starting voice never silently changes the existing Auto-apply setting.
- Preserve unrelated in-progress layout changes in this checkout.
- Read relevant installed Next.js guides before writing framework code.
- Audio and interim transcripts are not persisted.

## Task 1: ElevenLabs transport

**Files:** Create `src/features/voice/server.ts`, `src/app/api/voice/session/route.ts`, `src/app/api/voice/speech/route.ts`, `src/features/voice/transport.ts`, `public/voice-capture.js`, and `tests/voice-server.test.ts`. Modify `.env.example` only to append voice settings.

**Interfaces:** Export `connectMicrophone({onSpeechStart, onPartial, onUtterance, onError}, signal): Promise<{mute(value:boolean):void; close():void}>` and `speak(text, signal, onStart): Promise<void>`. Speech starts invoke `onStart` once, immediately before actual first audio playback. Completion means playback, not download completion. Microphone close must synchronously release recording resources. Server exposes POST `/api/voice/session` returning a Scribe token and POST `/api/voice/speech` accepting `{text}` and returning streaming PCM audio at a documented sample rate.

- [ ] Write request tests for missing configuration, invalid/oversized input, origin rejection, cancellation, and sanitized upstream failure. Use injected fetch/config; assert response status and body and actual upstream URL/body.
- [ ] Run `npx vitest run tests/voice-server.test.ts` and confirm the missing behavior fails.
- [ ] Implement server handlers using fixed ElevenLabs hosts, bounded requests, server-only credentials, and streamed audio. Verify current endpoint contracts against official documentation.
- [ ] Implement microphone capture, short audio frames, local voice activity interruption, Scribe partial/final events, mute and complete cleanup. Guard late events by the signal.
- [ ] Implement audio playback with abortable fetch and audio buffers, an actual-playback start callback, and completion after the last sample. Stop and discard queued buffers on abort.
- [ ] Run focused tests and typecheck. Document environment names and any live limitations.

## Task 2: Progressive editor presentation

**Files:** Create `src/features/voice/presentation.ts`, `src/features/voice/progression.ts`, `tests/voice-progression.test.ts`. Modify `src/features/workspace/TextEditor.tsx` and `src/features/board/BoardEditor.tsx` through narrow preview integration.

**Interfaces:** `presentChange(proposal, preview, signal, durationMs): Promise<void>` animates but never commits. A voice presentation store holds target, immutable base revision/content, displayed preview, and turn identity. Export cancellation/clear behavior for session cleanup. The original `approve` remains responsible for validated commit.

- [ ] Test deterministic text reveal with line boundaries and board reveal with stroke prefixes; assert final values by hand and unchanged originals.
- [ ] Run the focused test and confirm failure before implementation.
- [ ] Implement pure progression functions and a cancellation-aware presentation store. Partial frames do not change `useWorkspace.data`.
- [ ] Render code/note previews in the real editor without recording animation frames in undo. On manual input cancel and restore canonical content before allowing the edit. Board animation similarly stays outside persisted store updates.
- [ ] Integrate clear-on-abort, hidden editor behavior, reduced motion, and exact final canonical restoration.
- [ ] Verify no preview enters model screenshots, saves, exports, or Python source.

## Task 3: Teaching steps and collaborator playback

**Files:** Modify `src/features/ai/server/tools.ts`, `src/features/ai/server/prompt.ts`, `src/features/ai/useCollaborator.ts`; create `src/features/voice/playback.ts`, `tests/voice-playback.test.ts`, and collaborator integration cases in `tests/voice-collaborator.test.ts`.

**Interfaces:** A validated `teach_step` accepts `{speech:string, operation?: {name, args}}`; permitted operations are existing edit/attention operations, never nested teaching or arbitrary execution. Collaborator options accept optional voice callbacks for speech playback, preview playback, delivery events, and a boolean voice-mode getter. Existing public text methods remain compatible.

- [ ] Write a test with deferred audio completion: after `onStart`, presentation has begun while speech remains pending; abort stops both and prevents commit.
- [ ] Add tool validation tests for malformed nested operations, overlong speech, and unsupported execution.
- [ ] Implement concurrent playback using a single AbortSignal and await both outputs. Treat audio failure as cancellation of the visual step.
- [ ] Route paired edits through current stage/approve logic; after approval, play speech and preview, revalidate, and commit through `applyProposal`. Keep ordinary text proposals unchanged.
- [ ] Add voice context and prompt policy for short paired steps, genuine completion reporting, interruption records, and fresh reads after changed context. Speech-only steps remain supported.
- [ ] Run voice, AI server/client, recovery, and budget tests. Ensure tool continuation signatures and current request budgets remain intact.

## Task 4: Session controls and interruption flow

**Files:** Create `src/features/voice/useVoiceSession.ts`, `src/features/voice/VoiceControls.tsx`, `src/features/voice/VoiceControls.module.css`, and `tests/e2e/voice.spec.ts`; modify `src/features/workspace/WorkspaceShell.tsx` through narrow integration.

**Interfaces:** Session owns microphone/turn lifecycle and exposes start, mute, pause, resume, end, status, and transcript. Controls remain accessible whenever capture is active. New utterances cancel the old collaborator before asking with current context.

- [ ] Add browser cases for unavailable voice configuration and typed collaboration fallback, and fixture-driven interruption during an active visible preview.
- [ ] Implement shell-owned state and controls. Start is explicit; mute discards partial input; end/unmount closes all media resources and cancels stale work.
- [ ] Wire local speech-start to immediate output cancellation and committed utterances to exactly one new request. Handle partial transcripts without submitting them prematurely.
- [ ] Preserve the last goal and delivery record for resume/replanning. Do not treat queued or unheard speech as heard.
- [ ] Verify actual editor interactions in Playwright, including undo and manual changes during preview.

## Task 5: Integration verification and live acceptance

**Files:** Update `README.md`, `docs/ai-collaboration.md`, and this plan's progress record, touching only voice sections.

- [ ] Run `npm run typecheck`, the unit suite, targeted AI/editor/voice browser tests, and production build. Inspect every result.
- [ ] Review the diff against the spec: concurrency, cancellation, stale events, persistence, credentials, and text-mode behavior.
- [ ] When credentials are present, perform the binary-search live demonstration and report measured timing and audible quality separately from fixture results.
- [ ] If credentials are unavailable, finish all local verification and clearly report that account-backed speech and microphone quality remain unverified.

## Review notes

The tasks share only the interfaces above; transport and visual preview own separate resources, and the collaborator remains the only writer. Sentence-level timing is the first acceptance target. Respecting the existing Auto-apply preference resolves the earlier unanswered product choice without silently granting broader edit permissions.
