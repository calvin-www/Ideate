# Study workflow updates

**Goal:** Deliver auto-apply, rendered math, chat clearing, Python stepping, clearer teaching, and per-domain/full workspace clearing.

**Design:** Extend the current collaborator and isolated runner. Auto-apply is a browser preference, initially off; every edit still passes validation and creates an undo entry. Clear chat cancels the active job before deleting messages, preserving documents, runs, and saved references. Chat and notes share math plugins with source offsets preserved. Python debugging pauses before each executed source line, exposes bounded local-variable snapshots, and offers Step, Continue, and Stop. Paused time does not consume the execution limit. Debugging uses Pyodide JSPI support in supported browsers; normal Run remains available elsewhere.

## Implementation and verification

- [x] Add collaborator regression cases for auto-apply, stale edits, and clear-during-review/stream. Extend `store.ts`, `useCollaborator.ts`, and `ChatPanel.tsx`; verify `tests/ai-server-client.test.ts`.
- [x] Add shared math rendering for dollar and LaTeX delimiters without changing source offsets or code spans. Extend chat and notes renderers and root CSS; verify rendered HTML and browser previews, including source cues.
- [x] Expand `server/prompt.ts` teaching instructions and describe edit-policy behavior accurately. Review the prompt as prose; do not test exact wording.
- [x] Add debugger protocol validation and lifecycle regressions. Extend `runner/protocol.mjs`, controller, worker, and Python runtime, plus `runner-client.ts`. Verify real browser pauses, variables, stepping into functions, continuation, errors, time limits, and Stop/restart.
- [x] Connect debug state through `useExecution.ts` to `CodePanel.tsx`, highlight the next line in `TextEditor.tsx`, and identify edits made during a paused run as stale. Verify browser controls and responsive layout.
- [x] Run full unit/integration tests, typecheck, production build, and browser tests. Review the final changes and update product documentation.
- [x] Add a global data-clear dialog with one clear for each domain and one full reset, confirmations, export access, and a short table-flip animation. Stop affected active work, invalidate stale edits, discard cleared editor undo stacks, persist the empty data, and respect reduced motion. Verify scope isolation and reload behavior.

Existing uncommitted attention-cue work is retained. Work is performed in the current checkout; no deployment or commit is part of this request.

Verification completed: 133 tests in 16 suites, all 19 browser tests, typecheck, and production build passed. After the final narrow-header spacing fix, the production build and the mobile browser regression passed again, including control bounds at 320px and 390px. Desktop and mobile screenshots were inspected. Independent code review findings were fixed and rechecked.
