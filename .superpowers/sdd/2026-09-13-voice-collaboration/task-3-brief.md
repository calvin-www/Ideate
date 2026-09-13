## Task 3: Teaching steps and collaborator playback

**Files:** Modify `src/features/ai/server/tools.ts`, `src/features/ai/server/prompt.ts`, `src/features/ai/useCollaborator.ts`; create `src/features/voice/playback.ts`, `tests/voice-playback.test.ts`, and collaborator integration cases in `tests/voice-collaborator.test.ts`.

**Interfaces:** A validated `teach_step` accepts `{speech:string, operation?: {name, args}}`; permitted operations are existing edit/attention operations, never nested teaching or arbitrary execution. Collaborator options accept optional voice callbacks for speech playback, preview playback, delivery events, and a boolean voice-mode getter. Existing public text methods remain compatible.

- [ ] Write a test with deferred audio completion: after `onStart`, presentation has begun while speech remains pending; abort stops both and prevents commit.
- [ ] Add tool validation tests for malformed nested operations, overlong speech, and unsupported execution.
- [ ] Implement concurrent playback using a single AbortSignal and await both outputs. Treat audio failure as cancellation of the visual step.
- [ ] Route paired edits through current stage/approve logic; after approval, play speech and preview, revalidate, and commit through `applyProposal`. Keep ordinary text proposals unchanged.
- [ ] Add voice context and prompt policy for short paired steps, genuine completion reporting, interruption records, and fresh reads after changed context. Speech-only steps remain supported.
- [ ] Run voice, AI server/client, recovery, and budget tests. Ensure tool continuation signatures and current request budgets remain intact.

