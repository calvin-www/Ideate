## Task 2: Progressive editor presentation

**Files:** Create `src/features/voice/presentation.ts`, `src/features/voice/progression.ts`, `tests/voice-progression.test.ts`. Modify `src/features/workspace/TextEditor.tsx` and `src/features/board/BoardEditor.tsx` through narrow preview integration.

**Interfaces:** `presentChange(proposal, preview, signal, durationMs): Promise<void>` animates but never commits. A voice presentation store holds target, immutable base revision/content, displayed preview, and turn identity. Export cancellation/clear behavior for session cleanup. The original `approve` remains responsible for validated commit.

- [ ] Test deterministic text reveal with line boundaries and board reveal with stroke prefixes; assert final values by hand and unchanged originals.
- [ ] Run the focused test and confirm failure before implementation.
- [ ] Implement pure progression functions and a cancellation-aware presentation store. Partial frames do not change `useWorkspace.data`.
- [ ] Render code/note previews in the real editor without recording animation frames in undo. On manual input cancel and restore canonical content before allowing the edit. Board animation similarly stays outside persisted store updates.
- [ ] Integrate clear-on-abort, hidden editor behavior, reduced motion, and exact final canonical restoration.
- [ ] Verify no preview enters model screenshots, saves, exports, or Python source.

