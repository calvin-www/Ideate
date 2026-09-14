# Implementation status

Updated September 13, 2026. The user explicitly authorized implementation after approving the product plan, then authorized subagents. This is a fresh implementation; the earlier repository remains a design reference. The app deploys as a single Next.js project with the Python runner bundled.

## Delivered

- **Functional study desk:** Three.js / React Three Fiber meshes for the whiteboard, computer, journal, and desk. Objects open full-size editors. Labels, keyboard-accessible navigation, reduced motion, current-content previews, and small-screen/WebGL fallbacks are present. The scene is unmounted while tools are visible.
- **Whiteboard:** Excalidraw drawing, text, shapes, connectors, selection, native undo/redo, pan/zoom, Fit drawing, and a loadable binary-search diagram. PNG, JPEG, and WebP images support file drops, screenshot paste, and the image tool; binary data is saved locally, exported/imported, retained for undo, and included in board previews. Images are limited to 5 MB each and 10 MB of encoded data per board. Embedded websites and remote-image drags are unsupported. AI changes use validated element operations, real label measurements, and reciprocal arrow bindings.
- **Computer:** One Python file with CodeMirror highlighting, line numbers, search, undo/redo, Run/Stop, resizable output, stale-result labels, traceback line navigation, and download. Debug pauses live execution before source lines, highlights the next line, and shows bounded local values. Step enters functions, Continue finishes the captured program, and Stop terminates a paused or busy worker. Source edits mark the debug snapshot stale. JSPI browser support is required for Debug; ordinary Run remains available without it. No terminal, REPL, package installer, or interactive input.
- **Journal:** Markdown editing and rendered preview with tables, lists, code blocks, LaTeX math, download, and saved source links. Chat shares the math renderer. Dollar and LaTeX parenthesis/bracket delimiters preserve source positions; code spans stay literal. Raw HTML does not execute.
- **Shared Gemini collaborator:** Immutable workspace/selection context, bounded reads, optional board image, streamed responses, text diffs, board previews, Apply/Reject, Apply & run, cancellation, revision checks, and undo. Conflicting undo shows the replaced content and requires an explicit restore; the restore is itself undoable.
- **Persistence:** Browser-owned workspace in IndexedDB, serialized saves, schema checks before save/load, validated and normalized import, JSON export, and preserved historical run/source excerpts. Invalid saved data is retained for recovery instead of being overwritten by defaults.
- **Study controls:** Remembered auto-apply preference (on by default), using the same validation and undo path as reviewed changes. Clear chat cancels active work and deletes persisted messages. A global clear-data dialog provides separate board/code/notes clears and a full reset with a table-flip animation, confirmation, export access, keyboard handling, and reduced-motion support. Cleared domains discard their undo stacks; a full reset removes artifacts and history and restores the auto-apply default.
- **Teaching instructions:** Answer-first explanations, short paragraphs, defined terms and symbols, concrete examples, respectful corrections, and detail matched to the student's question. These are prompt policies; model responses remain probabilistic.
- **Isolated Python:** App-served runner iframe, restrictive CSP, message validation, a Worker per run, bundled Pyodide assets, ten-second execution and 64 KiB output limits, immediate initial trace output, and restart after completion/Stop/failure. No application secrets or workspace data enter the runner beyond the submitted code.

## Actual entry points

| Area                         | Source                                                                    |
| ---------------------------- | ------------------------------------------------------------------------- |
| Workspace/navigation         | `src/features/workspace/WorkspaceShell.tsx`                               |
| Model, revision checks, undo | `src/features/workspace/model.ts`                                         |
| State and saving             | `src/features/workspace/store.ts`, `persistence.ts`, `importWorkspace.ts` |
| Desk                         | `src/features/desk/DeskScene.tsx`                                         |
| Whiteboard                   | `src/features/board/BoardEditor.tsx`, `adapter.ts`                        |
| Python / Markdown panels     | `src/features/code/CodePanel.tsx`, `src/features/notes/NotePanel.tsx`     |
| Shared text editor           | `src/features/workspace/TextEditor.tsx`                                   |
| AI client / review UI        | `src/features/ai/useCollaborator.ts`, `ChatPanel.tsx`                     |
| Gemini server                | `src/app/api/ai/route.ts`, `src/features/ai/server/`                      |
| Runner and integration       | `runner/`, `src/features/execution/`                                      |

## Verification evidence

The test suites use fixtures for deterministic Gemini behavior, real Pyodide for execution, and actual Excalidraw in isolated browser tests for diagram operations. They cover rejected/stale/duplicate/cancelled edits, immutable context, source provenance, safe restore, save ordering and recovery, invalid imports, runner isolation, output limits, timeouts, Stop/restart, and stream mutations between runs.

Story-update regressions cover reviewed and automatic edits, clearing during active chat, math source offsets, per-domain and full resets, persisted empty workspaces, retained chat drafts, and reduced motion. Real Python tests cover stepping, top-level await, bounded inspection without user-defined display methods, and worker heartbeat timeouts when background native work blocks an inspected run. Browser tests exercise stale debug snapshots, the clear animation, and mobile controls.

Browser verification covers the real binary-search target-16 result (index 4), target-17 result (not found), Python errors and source lines, empty code, infinite-loop Stop/restart, Markdown rendering, and board/code/note persistence after reload. The 390 × 844 layout was inspected: object cards and Python editing/output fit without horizontal page overflow. Hidden editors remain mounted and inert.

Final verification after review fixes and formatting:

| Check                     | Result                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `npm test`                | 133 tests passed in 16 suites                                 |
| `npm run test:e2e`        | 19 tests passed against the optimized production server       |
| `npm run typecheck`       | Passed, including route-type generation                       |
| `npm run build`           | Passed                                                        |
| `npm audit`               | No known vulnerabilities reported                             |
| Desktop/mobile inspection | Rendered desk and tools checked at desktop size and 390 × 844 |

Pinned dependency updates and overrides eliminated the advisories reported by the initial install. The audit describes the checked dependency set, not a guarantee against future advisories.

### Live Gemini evidence

- The account's `gemini-3.8-flash` passed streamed-text, image, and real function-call/continuation preflight checks, including preservation of thought signatures.
- In the browser, Gemini explained the actual board comparison: midpoint index 3 holds 12, which is below target 16, so indices 0–3 can be discarded.
- Gemini proposed a note about sorted input; applying it updated the Markdown preview.
- A subsequent live request read the recorded Python run and proposed notes with clickable whiteboard/output links. After acceptance, the Python link opened the exact saved trace ending in `Found at index 4`.
- Other live requests encountered upstream failures and rate limiting. Those failures were visible; accepted notes and existing documents remained intact. One provider 503 retry is allowed only before streaming begins. Rate limits are not retried automatically.

This verifies real explanation, notes editing, provenance, and tool continuation. AI code/board edits also have deterministic contract and UI coverage; a consistently repeatable, multi-step live three-minute demo under provider load is not yet claimed.

## Running and demonstrating

Follow the [root README](../README.md). `npm run dev` copies the runner into `public/runner/` and starts the app at `http://localhost:3000`; the Python runner is served from that same origin. `.env.local` holds the server-only Gemini key and is ignored by Git. `.env.example` contains placeholders only.

A [prepared study workspace](examples/README.md) contains an actual recorded run and accepted source-linked notes. It is explicitly labeled as prepared. Import it for a fallback demonstration, then run Python again for fresh output. No prerecorded response is presented as live AI.

## Remaining limits

- Gemini quota, latency, and availability govern the live AI experience. A full pedagogical evaluation and three consecutive live rehearsals remain presentation preparation work.
- The app deploys as one Next.js project (the Python runner is bundled by `npm run build`). Public deployment still needs request/account controls and a provider spending policy for the AI routes.
- Source links into notes are implemented. A general relationship graph and board/code metadata links are not implemented.
- Pending proposals and execution jobs do not resume after a browser reload. Saved work survives; unfinished messages/runs are marked interrupted.
- Recent history is bounded to 200 messages, 40 undo changes, 100 runs, and 1,000 operation IDs. Reference retention prioritizes links in the current notebook. Editors limit text to 200,000 characters; the save/import boundary validates all documents. Very large drawings or reference sets can still reach their explicit document limits, at which point saving reports an error and export remains available.
- The runner shares the app origin; its CSP, Worker, and empty-globals boundary is for study code, not hostile code. Browser memory is not governed by a hard per-run memory quota.
- Multiplayer, voice, an animated companion, authentication, multiple projects, custom rooms, trace playback, and on-demand asset generation remain outside the MVP.

The original [implementation plan](implementation-plan.md) retains the full acceptance and demo plan. Organizer clarification is still required before treating earlier work as reusable HackRice submission code; this implementation did not copy it.
