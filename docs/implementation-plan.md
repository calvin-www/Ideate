# Ideate Implementation Plan

**Goal:** Deliver a persistent 3D study desk that connects algorithm diagrams, basic Python execution, and learning notes through one Gemini collaborator.

**Architecture:** A browser-owned workspace synchronizes three editor adapters, local persistence, a separate-origin Python runner, and a server-mediated Gemini conversation. The desk renders navigation and previews without owning document state.

**Tech stack:** Next.js, React, TypeScript, React Three Fiber, Excalidraw, CodeMirror 6, Zustand, IndexedDB, Pyodide, and the Google GenAI SDK.

**Spec:** [Product](product.md), [interaction design](interaction-design.md), [architecture](architecture.md), and [AI collaboration](ai-collaboration.md).

**Execution status:** The user explicitly instructed implementation and authorized subagents. The application now exists; see [implementation status](implementation-status.md) for current evidence and limits. The checklist below remains the acceptance plan, rather than a substitute for observed results.

This is the accepted milestone-level plan. The build uses a fresh codebase, pinned dependencies, local development credentials, and parallel work on the scene, runner, and Gemini boundary.

## Global constraints

- Algorithm study is the primary use case; use binary search for the first demonstration.
- One board, one `main.py`, one `notes.md`, one conversation, one workspace.
- The computer provides Run/Stop, printed output, and errors. No terminal, REPL, shell, interactive input, or package manager.
- Python standard library is sufficient. Start with the ten-second execution and 64 KiB output limits described in the architecture.
- Gemini is the product provider; `gemini-3.8-flash` passed account, text, image, and function-call checks. Provider availability can still vary.
- Use a fresh implementation. Treat old code, prompts, and assets as reference unless specific reuse is cleared.
- Preserve manual edits, revision-bound references, local saves, and reviewable AI changes.
- 3D objects must be functional, with full-size editors and a 2D navigation fallback.
- Do not assume a fixed time budget. Reassess optional polish after each completed milestone.

## Proposed module map

These paths describe the planned responsibility map. The delivered code combines some adapters and orchestration modules; see the implementation status for actual entry points.

| Proposed location                                            | Responsibility                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `src/app/page.tsx`                                           | Workspace entry point                                                       |
| `src/app/api/ai/route.ts`                                    | Server-side Gemini requests and streamed responses                          |
| `src/features/workspace/model.ts`                            | Artifact, revision, reference, run, and change-set definitions              |
| `src/features/workspace/store.ts`                            | Shared workspace state and serialized mutations                             |
| `src/features/workspace/persistence.ts`                      | IndexedDB hydration, write queue, validation, export/import                 |
| `src/features/workspace/WorkspaceShell.tsx`                  | Navigation, editor lifetime, shared chat placement, save status             |
| `src/features/board/BoardEditor.tsx` and `adapter.ts`        | Excalidraw integration, selections, scene changes, previews                 |
| `src/features/code/CodeEditor.tsx` and `adapter.ts`          | Python editing, transactions, source snapshots                              |
| `src/features/notes/NoteEditor.tsx` and `adapter.ts`         | Markdown editing, preview, source link navigation                           |
| `src/features/execution/runner-client.ts`                    | Validated runner messages, status, timeout, output capture                  |
| `runner/`                                                    | Separate static runner origin, iframe bridge, Worker, pinned runtime assets |
| `src/features/ai/context.ts` and `operations.ts`             | Context capture, schemas, operation dispatch, validation                    |
| `src/features/ai/controller.ts` and `ChangePreview.tsx`      | Jobs, provider continuation, review, cancellation, conflict handling        |
| `src/features/desk/DeskScene.tsx` and `ObjectNavigation.tsx` | Scene composition, transitions, accessible object controls                  |
| `tests/`                                                     | Focused contract and browser integration checks described below             |

## Milestone 0: establish feasibility

**Dependencies:** Explicit implementation authorization. The default fresh-build path does not depend on permission to reuse old application code.

- [ ] Check the current compatible dependency set and select exact versions for a reproducible install.
- [ ] Verify Gemini account access with a small text/image/function-call request, without exposing the credential to the browser.
- [ ] Prove an Excalidraw scene can accept an annotation, preserve arrow bindings, and undo the accepted change.
- [ ] Prove a separate-origin Worker can print, raise a Python error, terminate an infinite loop, and run again.
- [ ] Prove the runner cannot access application storage or invoke workspace mutations.
- [ ] Record experiment results and any necessary changes to the technical decision log.

**Exit condition:** There is evidence for the selected model, board adapter, execution lifecycle, and origin boundary. These tests are about feasibility; they do not require a decorated desk.

**If an experiment fails:** Fix or simplify that boundary before building dependent features. Choose another available Gemini model with the required capabilities if necessary. Do not replace isolated execution with execution on the application server or UI thread.

## Milestone 1: persistent manual study tools

**Dependencies:** Milestone 0. Produces the artifact/revision and runner contracts consumed by AI and the scene.

- [ ] Create the workspace shell, shared model, editor adapters, and hydration barrier.
- [ ] Add the board's standard drawing, text, shape, arrow, and selection tools.
- [ ] Add one Python file, Run/Stop, printed output, error feedback, stale-result indication, and source download.
- [ ] Add one Markdown notebook with Edit/Preview, local saving, and Markdown download.
- [ ] Serialize persistence writes and capture current editor content before navigation, execution, and context requests.
- [ ] Add versioned workspace export/import with validation and a replacement confirmation.
- [ ] Preserve run snapshots and mark interrupted operations correctly after reload.

**Exit condition:** Without AI or a 3D scene, a student can draw, edit Python, run it, write notes, switch tools immediately, and reload without losing saved content.

**Required checks:** Final-keystroke/final-stroke capture, empty-document persistence, save failure recovery, hydration before defaults, no-output success, traceback mapping, timeout, output limit, and cancellation followed by a successful run.

## Milestone 2: shared Gemini collaborator

**Dependencies:** Milestone 1. Consumes artifact snapshots and revisions; produces reviewable changes, grounded messages, and source links.

- [ ] Build immutable selection context with visible context chips and bounded on-demand reads.
- [ ] Connect the server-side Gemini endpoint and preserve provider continuation data across tool results.
- [ ] Implement the explicit read, edit, run, and reference operations in the AI contract.
- [ ] Present text diffs and board previews before mutation; add Apply/Reject and Apply & Run.
- [ ] Apply accepted edits through adapters, record change sets, and return actual results to the model.
- [ ] Enforce base revisions, source-context freshness, operation idempotency, and one active AI job.
- [ ] Add Stop, error recovery, and inverse-change review when undo conflicts with later manual edits.
- [ ] Add the four selection shortcuts and the study-partner behavior.

**Exit condition:** The collaborator can explain a selected artifact and propose valid edits in each tool. A late or repeated response cannot overwrite a manual edit or apply twice.

**Required checks:** A revision-N proposal rejected at N+1; a duplicate accepted operation; cancellation before acceptance; cancellation after one accepted step; changed source context; a read-only explanation; malformed ranges and board bindings; manual typing while generation is pending.

## Milestone 3: complete the study loop

**Dependencies:** Milestone 2. Integrates the existing tools without adding a custom algorithm engine.

- [ ] Walk through the binary-search example defined in the product document.
- [ ] Generate Python with explicit trace prints, review it, and capture actual run output.
- [ ] Change the target manually and execute the changed revision.
- [ ] Select a recorded output step and propose a matching static board explanation.
- [ ] Append notes capturing the question, invariant, correction, and source references.
- [ ] Open references from notes and preserve the right source revision or excerpt after subsequent edits.

**Exit condition:** Diagram -> Python -> actual trace -> board explanation -> session notes works end to end. The AI labels uncertainty if the available output cannot establish a requested intermediate state.

**Required checks:** Target present, target absent, empty array, and a one-element array for the demonstration program. Confirm that successful and failed runs are described accurately and that a hint request does not immediately produce a full solution.

## Milestone 4: functional 3D desk

**Dependencies:** Milestone 3. Consumes navigation and derived previews; must not change artifact ownership.

- [ ] Build the desk, computer, whiteboard, and journal with simple geometry and inexpensive lighting.
- [ ] Add named accessible object buttons, generous hit targets, hover/focus states, and direct navigation.
- [ ] Open full-size editors with short transitions and retain their existing instances and view state.
- [ ] Add basic text/status previews and a board thumbnail where reliable.
- [ ] Render the scene on demand and suspend it behind opaque tools.
- [ ] Add reduced-motion behavior, smaller-screen cards, and graphics-failure fallback.

**Exit condition:** Every desk object opens the correct tool. Rapid switching, return navigation, keyboard activation, and scene failure preserve the study session.

**Required checks:** Repeated hide/show of Excalidraw with correct pointer coordinates; keyboard-only navigation; no focus in hidden editors; reduced motion; narrow layout; WebGL failure; frame behavior on the demonstration laptop.

## Milestone 5: reliability and demo preparation

**Dependencies:** Milestones 1-4.

- [ ] Exercise the complete acceptance matrix below and resolve failures in the core workflow.
- [ ] Complete required project checks and a production build after the application exists.
- [ ] Prepare a workspace export, a previously generated example clearly labeled as such, and a recording of a successful live demonstration.
- [ ] Rehearse three consecutive complete sessions, including one manual input change per session.
- [ ] Add visual polish only if it leaves all core acceptance checks passing.

**Exit condition:** The live study loop is repeatable, failures are recoverable, and the demo accurately distinguishes live operations from prepared fallbacks.

## Acceptance matrix

| Concern            | Evidence                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| State              | Immediate navigation and reload retain the last saved board/code/note changes                                  |
| Execution          | Success, no output, Python error, timeout, Stop, output cap, and restart behave distinctly                     |
| AI edits           | Review, rejection, ordinary undo, conflicting undo, stale context, and duplicate operations preserve user work |
| Grounding          | Notes and board explanations refer to the actual code revision and run                                         |
| Teaching           | Hint, explanation, and implementation requests produce the requested level of help                             |
| Accessibility      | Keyboard access, restored focus, hidden-tool isolation, and reduced motion work                                |
| Performance        | 3D can pause or fail without blocking editing and execution controls                                           |
| Persistence errors | Failed saves remain visible and recoverable through export                                                     |

Use focused automated checks for revision/idempotency logic, persistence ordering, and runner messages, plus browser integration checks for navigation and editor behavior. Do not build a broad test framework that distracts from proving these boundaries.

## Three-minute demonstration

| Time      | Action                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| 0:00-0:20 | Introduce a student struggling to connect a binary-search diagram to its code; show the desk |
| 0:20-0:50 | Open the board, select the array, and ask why one half can be discarded                      |
| 0:50-1:25 | Ask for Python with trace prints; review and apply the change                                |
| 1:25-1:55 | Run, manually change to a missing target, and run again                                      |
| 1:55-2:30 | Use an output step for a board explanation and capture the learning insight in the journal   |
| 2:30-3:00 | Open a source reference, return to the desk, and show that each tool retained its work       |

Rehearsal determines whether the live demo can fit every AI step. If latency is too high, show the board explanation from the first run and keep the second run's note capture as the final live operation. Do not hide prerecorded output inside a live-looking run.

## Failure and scope controls

**Slow or unavailable Gemini:** Show actual activity, allow continued manual work, and offer Stop/Retry. Retry captures current revisions. Use the explicitly labeled saved example or recorded session if required for the presentation.

**Python failure:** Preserve source and captured output, distinguish program errors from runtime failures, and restart the Worker when needed. Offer a bounded AI repair using the actual traceback. Never invent successful output.

**3D performance or loading failure:** Switch to object cards backed by the same workspace. Keep recognizable primitive objects as the default until the core experience is stable.

**Scope pressure:** Cut decorative assets, richer previews, animated playback, custom widgets, extra files/packages, and optional collaboration features. Preserve the study loop, state reliability, selected-context AI, edit review, and isolated execution.
