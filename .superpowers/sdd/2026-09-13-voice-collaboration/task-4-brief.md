## Task 4: Session controls and interruption flow

**Files:** Create `src/features/voice/useVoiceSession.ts`, `src/features/voice/VoiceControls.tsx`, `src/features/voice/VoiceControls.module.css`, and `tests/e2e/voice.spec.ts`; modify `src/features/workspace/WorkspaceShell.tsx` through narrow integration.

**Interfaces:** Session owns microphone/turn lifecycle and exposes start, mute, pause, resume, end, status, and transcript. Controls remain accessible whenever capture is active. New utterances cancel the old collaborator before asking with current context.

- [ ] Add browser cases for unavailable voice configuration and typed collaboration fallback, and fixture-driven interruption during an active visible preview.
- [ ] Implement shell-owned state and controls. Start is explicit; mute discards partial input; end/unmount closes all media resources and cancels stale work.
- [ ] Wire local speech-start to immediate output cancellation and committed utterances to exactly one new request. Handle partial transcripts without submitting them prematurely.
- [ ] Preserve the last goal and delivery record for resume/replanning. Do not treat queued or unheard speech as heard.
- [ ] Verify actual editor interactions in Playwright, including undo and manual changes during preview.

