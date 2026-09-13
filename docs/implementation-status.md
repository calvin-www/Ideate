# Implementation status

Updated September 12, 2026. The user explicitly authorized implementation after approving the product plan, then authorized subagents. This is a fresh local implementation; the earlier repository remains a design reference. Nothing has been deployed.

## Delivered

- **Functional study desk:** Three.js / React Three Fiber meshes for the whiteboard, computer, journal, and desk. Objects open full-size editors. Labels, keyboard-accessible navigation, reduced motion, current-content previews, and small-screen/WebGL fallbacks are present. The scene is unmounted while tools are visible.
- **Whiteboard:** Excalidraw drawing, text, shapes, connectors, selection, native undo/redo, pan/zoom, Fit drawing, and a loadable binary-search diagram. Image/embedded-site content is outside the supported document model. AI changes use validated element operations, real label measurements, and reciprocal arrow bindings.
- **Computer:** One Python file with CodeMirror highlighting, line numbers, search, undo/redo, Run/Stop, resizable output, stale-result labels, traceback line navigation, and download. Successful empty programs are distinct from failed runs. No terminal, REPL, debugger, packages, or interactive input.
- **Journal:** Markdown editing and rendered preview with tables, lists, code blocks, download, and saved source links. Raw HTML does not execute.
- **Shared Gemini collaborator:** Immutable workspace/selection context, bounded reads, optional board image, streamed responses, text diffs, board previews, Apply/Reject, Apply & run, cancellation, revision checks, and undo. Conflicting undo shows the replaced content and requires an explicit restore; the restore is itself undoable.
- **Persistence:** Browser-owned workspace in IndexedDB, serialized saves, schema checks before save/load, validated and normalized import, JSON export, and preserved historical run/source excerpts. Invalid saved data is retained for recovery instead of being overwritten by defaults.
- **Isolated Python:** Separate origin, restrictive CSP, message validation, a Worker per run, local Pyodide assets, ten-second execution and 64 KiB output limits, immediate initial trace output, and restart after completion/Stop/failure. No application secrets or workspace data enter the runner beyond the submitted code.

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

Browser verification covers the real binary-search target-16 result (index 4), target-17 result (not found), Python errors and source lines, empty code, infinite-loop Stop/restart, Markdown rendering, and board/code/note persistence after reload. The 390 × 844 layout was inspected: object cards and Python editing/output fit without horizontal page overflow. Hidden editors remain mounted and inert.

The production build and typecheck have passed. Pinned dependency updates and overrides eliminated the advisories reported by the initial install; `npm audit` reports no known vulnerabilities at verification time. See the final handoff for the final suite counts after all review fixes.

### Live Gemini evidence

- The account's `gemini-3.8-flash` passed streamed-text, image, and real function-call/continuation preflight checks, including preservation of thought signatures.
- In the browser, Gemini explained the actual board comparison: midpoint index 3 holds 12, which is below target 16, so indices 0–3 can be discarded.
- Gemini proposed a note about sorted input; applying it updated the Markdown preview.
- A subsequent live request read the recorded Python run and proposed notes with clickable whiteboard/output links. After acceptance, the Python link opened the exact saved trace ending in `Found at index 4`.
- Other live requests encountered upstream failures and rate limiting. Those failures were visible; accepted notes and existing documents remained intact. One provider 503 retry is allowed only before streaming begins. Rate limits are not retried automatically.

This verifies real explanation, notes editing, provenance, and tool continuation. AI code/board edits also have deterministic contract and UI coverage; a consistently repeatable, multi-step live three-minute demo under provider load is not yet claimed.

## Running and demonstrating

Follow the [root README](../README.md). `npm run dev` starts app origin `http://localhost:3000` and runner origin `http://localhost:3001`. `.env.local` holds the server-only Gemini key and is ignored by Git. `.env.example` contains placeholders only.

A [prepared study workspace](examples/README.md) contains an actual recorded run and accepted source-linked notes. It is explicitly labeled as prepared. Import it for a fallback demonstration, then run Python again for fresh output. No prerecorded response is presented as live AI.

## Remaining limits

- Gemini quota, latency, and availability govern the live AI experience. A full pedagogical evaluation and three consecutive live rehearsals remain presentation preparation work.
- The supported setup is local. Public deployment would need separate app/runner origins, deployment configuration, request/account controls, and a provider spending policy. None has been deployed.
- Source links into notes are implemented. A general relationship graph and board/code metadata links are not implemented.
- Pending proposals and execution jobs do not resume after a browser reload. Saved work survives; unfinished messages/runs are marked interrupted.
- Recent history is bounded to 200 messages, 40 undo changes, 100 runs, and 1,000 operation IDs. Reference retention prioritizes links in the current notebook. Editors limit text to 200,000 characters; the save/import boundary validates all documents. Very large drawings or reference sets can still reach their explicit document limits, at which point saving reports an error and export remains available.
- The runner's origin/CSP/Worker boundary protects the app. Browser memory is not governed by a hard per-run memory quota.
- Multiplayer, voice, an animated companion, authentication, multiple projects, custom rooms, trace playback, and on-demand asset generation remain outside the MVP.

The original [implementation plan](implementation-plan.md) retains the full acceptance and demo plan. Organizer clarification is still required before treating earlier work as reusable HackRice submission code; this implementation did not copy it.
