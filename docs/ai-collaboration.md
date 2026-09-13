# Shared AI collaboration

## Role

The AI is a study partner working on the student's existing artifacts. It explains algorithms, offers hints, connects diagrams to code, interprets actual Python output, and helps capture what the student learned.

Keep one conversation across Board, Code, Notes, and the desk. The active tool guides attention but does not limit the collaborator to that tool.

## Runtime model

The delivered collaborator uses Gemini through the server-side `@google/genai` SDK. The configured/default model is `gemini-3.8-flash`; `GEMINI_MODEL` can change it without a product model picker. `GEMINI_API_KEY` remains on the application server.

On September 12, 2026, the account preflight demonstrated streamed text, recognition of a blue square and orange circle, and a `read_code` function call followed by a response citing the supplied revision while preserving its opaque thought signature. Browser QA also received a live explanation. Subsequent requests intermittently returned provider HTTP 503, surfaced safely as a failed AI request; a live notes-proposal attempt also failed. Access and these examples are verified, but dependable capacity and the full binary-search teaching evaluation are not established.

Generation uses `models.generateContentStream` with manual function handling. Each endpoint request produces one logical model step, with bounded additional generations when an output cutoff can recover; the client owns the tool loop. Final answers are streamed text, not a JSON-only response schema. Full candidate parts and thought signatures are preserved for tool continuation.

Astra's role is development assistance, including application work and static assets. It is not the required model inside Ideate. On-demand asset generation, a model picker, and a multi-provider routing system are outside the MVP.

Use Ideate's Python runner for program execution. Responses that claim a program ran must cite the actual `ExecutionRun`; do not use a separate model-side execution environment to stand in for the student's run.

## Teaching behavior

These are system-prompt policies and product acceptance targets, rather than guarantees that every generated answer has been evaluated:

- Start from the student's question, selection, and attempt.
- Lead with the answer or next useful idea. Use short sentences and paragraphs, define unfamiliar terms and symbols, and ground explanations in a small example. Scale detail to the question, avoiding jargon, filler, repetition, and condescension.
- Render mathematical notation with inline dollar delimiters or display equations, then explain its meaning in words. Chat and notes also support LaTeX parenthesis/bracket delimiters without changing source offsets.
- Explain the relationship between representations: a diagram boundary, the code condition implementing it, and the run output demonstrating it.
- Give a hint when asked, and provide a complete explanation or implementation when explicitly requested.
- Offer a small prediction or experiment when useful, without requiring a quiz before answering.
- State meaningful assumptions, such as sorted input or inclusive bounds.
- If a drawing is ambiguous enough to change the algorithm, ask a focused question rather than inventing its meaning.
- Distinguish predicted behavior, observed behavior, and a hypothesis about an error.
- Prefer a few editable diagram elements to an image containing uneditable labels.
- Capture the student's misconception and correction in notes, with supporting references.
- Let the student continue editing and navigating while the AI works; completion does not take focus away.

Selection actions are prompt shortcuts: Explain visually, Give me a hint, Show this in Python, and Add this to my notes. They share the same context and operation machinery.

## Context at request time

Capture context after synchronizing the current editor state. The request has an immutable source selection; moving focus to chat or selecting something else does not retarget an in-flight job.

| Context           | Included information                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Learning question | Current instruction, explicitly stated goal, relevant prior question or misconception                                         |
| Active tool       | Desk, Board, Code, or Notes; current artifact ID and revision                                                                 |
| Selection         | Board IDs, code/note offsets tied to a revision, or a run/output range                                                        |
| Board             | Up to 100 selected/relevant elements, labels and connections; a whole-board export when available while asking from the board |
| Code and notes    | Selected ranges plus relevant surrounding or linked content                                                                   |
| Recent changes    | Last ten accepted AI change summaries, target IDs, and revisions; no complete manual edit log                                 |
| Execution         | Selected saved run or last two runs, source revision, status, bounded combined stdout/stderr, and timing                      |
| Conversation      | Recent messages, attached references, and the continuation data needed by the provider                                        |

The composer shows a removable selection chip, and messages show the attached source references. The current request includes a bounded overview of all three artifacts even when a selection is present. With no selection, the active artifact is the primary source; from the desk this defaults to code alongside the overview. Cropped-selection images and per-artifact removal controls for the overview are not implemented.

The client includes at most eight messages including the current question, roughly 20,000 JavaScript text units per code/note excerpt, and up to 4,000 text units from each of two initial run outputs. Reads expose bounded additional ranges and truncation metadata. These client excerpts use string offsets, not exact UTF-8 byte quotas. The server independently caps textual context at 192 KiB, image base64 at 2 MiB, total request at 6 MiB, continuation at 4 MiB, and tool results at 192 KiB. Oversized context receives a safe error rather than silently exceeding those limits. These are application budgets, not model context-window claims.

Manual edits are stored locally in this browser. Asking the study partner sends this context, source excerpts, recent conversation, and any attached board image through the application server to Gemini. The board image is sent as image input rather than serialized into a text prompt. The immutable snapshot and selection are cloned before asynchronous work; later reads add separate tool results rather than rewriting that original snapshot.

Keep manual content and runtime output as data. Instructions embedded in a diagram, comment, note, or printed string cannot grant additional operations or override the student's request. A vector database is unnecessary for this single-workspace scope.

## Operations

The partner can point to an existing board object or mark a Python/Markdown range while explaining it. `show_attention` takes `target`, exact `revision`, `mode` (`point` or `highlight`), and a short `label`. Board cues use 1–12 existing `ids`; text cues use UTF-16 `from`/`to` offsets. Highlights require a nonempty range. `clear_attention` removes one target's cue, or all cues when `target` is omitted. These visual tools require no edit review and never change artifact content or the student's selection.

Cues follow board pan/zoom and editor scrolling. The current domain reveals the target, unfolding the relevant code when needed; other domains get a **Show** button in chat. Journal preview marks the containing rendered blocks, with a fallback to the source editor for content that has no rendered block. Each domain holds one cue, so the partner can connect ideas across the board, code, and notes. Students can dismiss any cue. Cues are transient: they clear on a new question, cancellation, failure, workspace replacement, or a change to their target. They are excluded from saved/exported workspaces. Python run output is not a cue target.

All operations identify their target explicitly. The model requests operations; application adapters perform them. Validate schema, allowed fields, identifiers, payload limits, and current state independently of model output.

| Operation        | Inputs                                                                 | Result or effect                                                                                                      |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `read_board`     | `{ids?: string[]}`                                                     | Bounded elements/connections, revision, and source reference; image is attached to the initial request when available |
| `edit_board`     | `{baseRevision, additions, updates, deleteIds, summary}`               | Proposed diagram change to the single board                                                                           |
| `read_code`      | `{from?: number, to?: number}`                                         | Python text excerpt, offsets, full length, revision, and source reference                                             |
| `edit_code`      | `{baseRevision, replacements: [{from,to,text}], summary}`              | Proposed Python change                                                                                                |
| `read_notes`     | `{from?: number, to?: number}`                                         | Markdown excerpt, offsets, full length, revision, and source reference                                                |
| `edit_notes`     | `{baseRevision, replacements: [{from,to,text}], summary}`              | Proposed Markdown change; appending uses `from = to = document.length`                                                |
| `run_python`     | `{revision}`                                                           | Requests the current code at exactly that revision; returns the actual saved run result                               |
| `read_run`       | `{id, from?: number, to?: number}`                                     | Existing run's saved source, bounded output range, status, timing, and source reference                               |
| `link_artifacts` | `{sourceIds: string[], target: 'board' \| 'code' \| 'notes', summary}` | For `notes`, a reviewed append of Markdown source links; board/code metadata targets return unsupported               |

Artifact targets are implicit in each tool name because this version has one board, one Python document, and one notes document. The provider argument schema does not contain a job ID, expected source text, filename, or source hash. The client adds job/operation identity and source-revision guards before staging a proposal. Python execution captures the exact current source and revision in the browser; no source hash is computed.

Board additions support rectangle, ellipse, diamond, text, and arrow, with required geometry and optional text/start/end IDs. The study partner can also use the pen with `{type: "freedraw", points: [{x, y}, ...], strokeColor?, strokeWidth?}`. Each stroke has 2–512 ordered absolute board coordinates, spans at most 10,000 units per axis, and becomes a native editable Excalidraw element. Its origin and dimensions are derived from the points; no separate x/y/width/height fields are accepted. Optional color uses three- or six-digit hex, and width is 0.5–10 (default 2). Separate additions create separate strokes; repeating the first point closes a loop. Strokes use the same preview, approval/auto-apply, revision checks, undo, and persistence as other board edits. Updates are limited to existing IDs and text, color, or position fields. The adapter supplies Excalidraw metadata, validates geometry and bindings, and maintains bound labels and arrows. Arbitrary executable drawing code, embedded frames, and whole-scene model replacement are not accepted.

Code and notes use UTF-16 offsets relative to `baseRevision` and replacement text. Invalid or overlapping ranges are rejected. Whole-document revision comparison is the concurrency guard; there is no additional expected-text/hash check, automatic range rebasing, merge, or CRDT.

User Run and Apply & Run actions authorize their exact run. The AI can run code when the student explicitly requests execution; a request for an explanation alone does not start a program. Code-edit approval and execution results remain distinct.

## Proposal and job lifecycle

An AI job proceeds through reading, generating, awaiting review, applying or executing, and completion. Rejected/conflicted operations are returned to Gemini; messages record working, paused, complete, failed, cancelled, or interrupted state. Activity, paused continuation, and pending review live in the client controller. There is no separate durable job table, and provider continuation is not persisted across reload.

1. Capture the student's request, context references, and a unique job ID.
2. Send the bounded workspace overview, current instruction, and declared operation set.
3. Execute validated reads and return their results.
4. Receive and validate a proposed change. Show a text diff or board preview when auto-apply is off; otherwise proceed through the same application checks automatically.
5. Immediately before applying, recheck current revisions and job state.
6. Apply one accepted artifact edit, increment its revision, and record its change set and source links.
7. Return the actual application result to the model before it reports success or continues.

For code, Apply & Run combines acceptance of the displayed patch with execution of the resulting snapshot. Reject leaves the artifact unchanged. A multi-tool task is a sequence of named steps so partial completion is understandable.

Auto-apply defaults off and is saved as a browser preference, separate from imported workspace content. It affects new proposals; toggling it does not apply an already pending review. It never bypasses revision validation, duplicate-operation checks, undo recording, or explicit execution authorization. Tool results report acceptance before the model can claim success.

Clear chat aborts the active job and rejects late stream updates before emptying the persisted message history. Documents, executions, references used in notes, and accepted-change history remain. The next request contains no old conversation messages. Domain clearing also cancels active AI work and discards the affected editor's undo history; a full workspace clear removes all conversation and artifact history.

Use one active AI job and sequential mutations. Each budget permits up to eight model/tool rounds. The server defaults to 16,384 output tokens per generation and 32,768 across a user request, including thinking, retries, and tool rounds. `AI_MAX_OUTPUT_TOKENS` and `AI_MAX_JOB_OUTPUT_TOKENS` configure those limits. Every call reserves the smaller of the per-generation cap and the remaining budget before contacting Gemini. A completed `STOP` response with valid cumulative output/thinking usage refunds unused tokens; cutoffs, missing usage, cancellation, and provider errors retain the full reservation. Input tokens are separate from this output budget.

At `MAX_TOKENS`, text-only output can continue with its original provider parts and signatures. Incomplete tool attempts are discarded, including their displayed text, and regenerated as smaller operations; no calls are released without an explicit `STOP` and successful validation. Up to two automatic recoveries are allowed across the budget, including the existing initial 503 retry. All attempts within an HTTP request share its 55-second deadline. Deadline and transport failures still stop with a preserved partial answer.

Budget and round exhaustion produce a paused response. **Continue** explicitly grants another bounded budget using the saved provider state; it does not replay completed operations. The client retains the same answer, splitting very long answers into bounded message records to remain compatible with workspace persistence. Clear chat, cancellation, or a new question discards the resume action; changed artifacts require a new request with fresh context.

Server checkpoints are opaque, single-use tokens bound to the original messages, context, and provider history. They expire after 30 minutes and store only hashes and budget counters in a bounded process-local map. Missing, altered, replayed, or expired checkpoints fail closed. Resume state is not persisted across browser reloads, and a server restart or routing to another process invalidates checkpoints. Multi-replica hosting requires replacing this map with a shared atomic store before continuations can work across replicas. Completion logs contain the model, finish reason, token counts, allowance, remaining budget, and recovery count, without workspace text or credentials.

## Manual edits, stale responses, and duplication

Every staged `Proposal` includes `jobId`, a unique operation `id`, `target` (`board`, `code`, or `notes`), and `baseRevision`. Accepted IDs are saved in `acceptedOperations`; repeated Apply clicks cannot commit twice.

- A proposal based on revision N cannot overwrite revision N+1.
- Recheck on Apply, not only when the proposal arrives.
- On mismatch, preserve the manual edit and offer a new proposal from current content. Do not silently rebase text ranges.
- Initial context includes all three artifacts, so the current guard conservatively checks all three initial revisions. Editing notes can invalidate a pending code proposal even when the student considers the change unrelated. Explicit read results can refresh known source revisions. Narrower dependency tracking remains a refinement target.
- Remember accepted operation IDs so retried network responses cannot apply twice.
- Applying an operation returns its resulting revision; later steps use that revision explicitly.

Example acceptance scenario: request a binary-search implementation at code revision 4, manually change the file to revision 5, then receive the old response. Applying it must produce a conflict state with the revision-5 text intact.

## Undo and cancellation

Use native editor history for ordinary undo/redo and record each accepted AI step with an inverse change. Excalidraw updates must be captured as an undoable step; code and notes must use editor transactions.

The dedicated Undo AI action compares the current artifact with the accepted change's full after-snapshot. On a match it restores the before-snapshot at a new revision and marks the original change undone. If later manual edits cause a mismatch, the UI presents recovery for review; explicit restoration checks the reviewed revision and records the displaced content as a new undoable change. The saved representation uses full before/after snapshots, not minimal inverse patches.

Stop invalidates the job immediately, aborts provider requests where possible, and prevents further proposal application. Ignore late events using job and operation IDs. If the job owns a running Python execution, stop that run as well; do not stop an unrelated manual run.

Already accepted edits remain after cancellation and can be undone individually. On browser reload, mark unfinished jobs interrupted and never automatically replay a pending mutation.

## Grounded diagrams and notes

When asked to illustrate a run step, read the selected run's source and output. If output lacks the necessary variables, propose adding trace prints and rerunning instead of claiming to know unobserved execution state.

For the binary-search demo, print `low`, `high`, `mid`, midpoint value, and comparison outcome. The AI may propose a static board snapshot using those values. A trace playback engine is a stretch goal.

The bundled sample currently prints the bounds, midpoint, midpoint value, and final found/not-found result. It does not print the comparison outcome separately; adding that trace remains an appropriate proposal when needed for a grounded explanation.

Notes should include the question, key insight or correction, source links, and the relevant result. Source references retain revisions and excerpts. If the code later changes, the note still describes the run it actually referenced.

Initial context and read results supply exact reference IDs. Gemini can include `[label](#source:ID)` links in proposed notes; accepted changes save the referenced excerpts and revisions. `link_artifacts` with target `notes` uses the same diff/Apply/undo path to append visible links. The source viewer can display the saved excerpt after the live artifact changes. Board/code metadata links and a general relationship graph are not implemented.

## Failure handling and evaluation

Stream available response text and show actual operation status. Keep manual tools usable if Gemini fails. Offer cancellation/retry for slow responses and preserve already accepted work after an error. Retries begin with current revisions.

`POST /api/ai` accepts `{messages, context, continuation?, toolResults?, resume?}` and emits newline-delimited `text`, `replace`, `status`, `call`, `done`, `paused`, or `error` events. A tool-bearing `done` event carries `{continuation:{contents,token}}`; the next tool round supplies that checkpoint with matching tool results. `replace` replaces only text from the current HTTP step when a truncated tool attempt is discarded. `paused` carries `{message,resume:{contents,token,append}}`; only the explicit Continue action submits `resume`, without `continuation` or `toolResults`. The server validates and consumes its checkpoint before granting a fresh budget. Request/schema/access failures before streaming have HTTP error statuses. Failures after output begins produce an error event without a fabricated done event. The client displays the server's controlled error message, capped at 500 characters, without duplicating an identical error in both the message and the banner. Raw provider exceptions and credentials are not returned.

The local server enforces matching origin, bounded JSON depth/size, a process-local 36-requests-per-minute limit, and deadlines. An actual provider HTTP 503 before any stream chunk gets one retry after a cancellable 750 ms delay within the same 55-second deadline. Rate limits, local configuration errors, and partial streams are not automatically retried. A new user request starts from current workspace revisions. The local setup has no public authentication, distributed rate limiter, or account spending cap.

Evaluate: a labeled array, an ambiguous drawing, a request for only a hint, a full-code request, a missing-target run, a stale patch, a duplicate operation, cancellation before Apply, and notes grounded in an actual run. Check artifact correctness and teaching clarity rather than only whether a model returned valid JSON.

Automated tests cover request validation, safe error mapping, streaming/continuation, bounded retries, stale target/source edits, duplicate Apply, cancellation, unrequested-run rejection, immutable context, saved-run references, and reviewed notes links. Live browser checks also verified a reviewed notes append and a later source-linked explanation of the actual Python trace; clicking the Python output link opened the recorded revision and output. Provider errors and rate limiting prevented a claim of consistent live availability. The complete pedagogical evaluation, reliable multi-artifact live workflow under provider load, and public deployment are still targets.

Sources: [Gemini model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [function calling](https://ai.google.dev/gemini-api/docs/function-calling), [SDK libraries](https://ai.google.dev/gemini-api/docs/libraries). See [architecture](architecture.md) for storage and execution contracts.
