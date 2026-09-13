# Voice collaboration correctness review

Reviewed the actual shared-checkout files against `docs/superpowers/specs/2026-09-13-voice-collaboration-design.md`, including the transport Task 1 report, voice UI/coordinator/presentation modules, collaborator integration, tool schemas/prompt, and voice unit/browser tests. No implementation files were modified. Session turn identity/end cleanup and the currently failing editor-preview browser case are being fixed separately by the root agent and are excluded here.

## Findings

### P2: Intentional mute during reconnect shuts down the entire session

Location: `src/features/voice/transport.ts:342-348` (especially the unconditional reconnect catch at 347-348).

After a live session is muted, unmuting starts an asynchronous token request/socket connection. Muting again before that completes intentionally aborts `socketRequest` and closes the socket. The previous unmute's `openSocket().catch(...)` nevertheless calls `fail`, which checks only `active` and the outer session signal; neither has changed. It calls `onError` and closes the microphone. The UI consequently ends the voice session with Could not restart transcription. rather than staying muted. A rapid second unmute can also let this stale failure close a newer connection.

Reproduction: start voice, mute, unmute, and immediately mute while `/api/voice/session` is pending (or while its WebSocket is connecting). This was reproduced by executing the actual `transport.ts` through Node's `stripTypeScriptTypes`, with deterministic browser transport mocks and an abort-aware deferred second token request. Observed output: `{"errors":["Could not restart transcription."],"stoppedTracks":1,"tokenRequests":2}`.

Fix direction: capture the reconnect generation/controller and suppress intentional aborts and stale-generation failures. Check identity inside the failure path, not just message/open success paths. Add a transport regression for both token-fetch and socket-open cancellation during mute/unmute.

### P2: Standalone edit tools bypass voice playback and can commit silent edits

Location: `src/features/ai/useCollaborator.ts:662-666`, with `stage`/`approve` checking playback only when a `speech` string was supplied.

All ordinary `edit_*` and `link_artifacts` tools remain available and valid in voice mode. Unlike the nested `teach_step` path, this branch passes no speech to `stage`. With Auto-apply enabled, the proposal is committed immediately and no audio or progressive preview is started. A model can therefore return a perfectly valid ordinary `edit_code` call during a voice job, commit the edit silently, and later fail speech playback after the canonical mutation already occurred. Prompt guidance to use `teach_step` does not enforce the approved voice failure/commit contract.

Reproduction: use the existing collaborator fixture structure with `voice.enabled() === true`, Auto-apply enabled, and a model round returning `edit_code` followed by `done`. The ordinary staging path applies the edit without calling `voice.play`. A subsequent speech failure cannot undo that unpaired commit. This conclusion is from the directly traced executor path; no new test file was created.

Fix direction: reject unpaired mutating calls in voice jobs with an actionable tool result requiring `teach_step` (and decide how voice `link_artifacts` is paired), or explicitly route them through a validated paired presentation. Keep ordinary tools unchanged for text jobs. Test that voice-mode ordinary edits cannot commit without the playback gate.

### P2: Progressive text edits outside the first viewport remain invisible

Location: `src/features/voice/TextPresentation.tsx:16-17`.

Each presentation mounts a new independent CodeMirror editor with its default selection/scroll position at the document start. It neither mirrors the canonical editor's viewport nor reveals the replacement range as lines appear. Appending to a notes document longer than one viewport (the default notes edit behavior) therefore shows the unchanged top of the document throughout the speech, with all new lines below the viewport. Even a student already scrolled to the append location loses that view when the opaque presentation overlay appears. The result does not provide the intended visible concurrent writing for ordinary nonempty documents.

Reproduction: fill notes with several screens of text, scroll the canonical editor to the bottom, then approve/auto-apply a spoken `teach_step` appending a few lines. The overlay starts at the top and never follows the appended lines. This conclusion is from the new editor's props/lifecycle and absence of scroll/reveal handling; browser reproduction was not added while the root agent was debugging the shared preview test.

Fix direction: reveal the currently animated replacement range in the presentation editor without moving keyboard focus, and preserve useful viewport continuity. Add a browser assertion for an append beyond the initial viewport rather than only insertion at offset zero.

## Boundary and test observations

- The nested teaching schema recursively validates the existing operation contract; it excludes execution, and `approve` revalidates revisions after speech/presentation before the final apply. The reviewed path keeps animation data in the separate presentation store, preserving canonical saves, execution input, and undo history.
- The Task 1 report accurately describes the exported transport API and PCM framing. The generation guards protect stale successful connection/message callbacks, but the reconnect failure path has the race above. The report's claim that mute discards a session's late events needs to include those failures.
- Existing voice collaborator tests verify final commit ordering and late resolution after cancellation. Playback tests verify overlap and coupled failure. Progression tests cover pure text insertion and a stroke. The browser case covers a code insertion at offset zero; it does not cover the transport mute race, offscreen append, notes presentation, or actual Excalidraw progressive presentation/manual takeover.
- Existing tests were inspected; the focused suite was not rerun because the root agent already reported it passing and was changing the implementation concurrently. The deterministic mute-race probe above was executed successfully. No measured live latency or audible microphone behavior is claimed by this review.

## Follow-up review after root fixes

The root agent added speech pairing for ordinary voice mutation tools, a regression test for that gate, text-preview scrolling, ask-turn identity, and audio-context cleanup. The transport agent is addressing the reproduced mute race. The three findings above describe the initial reviewed state; the standalone mutation and initial-viewport issues are no longer present in the re-read implementation.

Additional concrete findings in the subsequent current files:

### P2: Board updates and deletions are not faithfully presented

Location: `src/features/voice/BoardPresentation.tsx:32-39`, together with the transparent `.board` overlay in `Presentation.module.css`.

The SVG displays only changed nondeleted elements on top of the unchanged canonical Excalidraw canvas. For an edit to an existing text label at the same position, the old and new words overlap until the final commit. A moved object appears at both locations. A deletion has no overlay element at all, so the supposedly removed object stays visible throughout the explanation, even after presentation progress reaches 1 while speech is still playing. These are valid `edit_board` operations supported by the teaching schema. Additions-only compositing cannot represent replacement/deletion semantics.

Reproduce with a board text element low = 0 and a spoken teaching step updating it to low = 4; hold speech after the visual completes. Both text versions remain visible. Alternatively delete one array element and observe that it remains on the visible canonical canvas until commit. The canonical data remains safe; the defect is the incorrect visual teaching state. Render/mask the affected originals without persisting preview frames, or use a detached complete-scene presentation. Include an actual Excalidraw test for label update/deletion.

### P2: Hidden presentation destinations have no reveal affordance

Location: `src/features/voice/VoiceControls.tsx:9-17`; presentation mounts only when its editor is active (`src/features/workspace/TextEditor.tsx:251`, `src/features/board/BoardEditor.tsx:441`). Notes Preview mode additionally hides its edit presentation (`src/features/notes/NotePanel.tsx:251-254`).

With the Computer visible, an auto-applied spoken notes or board teaching step can finish entirely offscreen. The persistent controls display only writing or drawing, and provide no target-specific Show action. The existing chat Show controls belong to attention cues, so a teaching edit alone does not create one; accepting review also clears its pending card before presentation begins. In Notes Preview mode, even selecting Journal keeps the source presentation hidden. This misses the design's explicit requirement that hidden target editors offer navigation to reveal the active writing.

Reproduce a `teach_step` editing notes while the Computer is visible, with Auto-apply on and no attention cue. There is no Show Notes control associated with the live writing. Offer existing navigation without stealing focus automatically, and handle switching Notes from rendered preview to its writing surface when explicitly revealed.

### P2: A superseded output's rejection can clear a newer presentation

Location: `src/features/voice/useVoiceSession.ts`, the `hooks.play` catch block (`if (heard) deliveries.current = ...; clearPresentation(); throw failure;`).

The updated `ask` completion uses a turn identity, but `hooks.play` still has unconditional global effects after awaiting its old playback promise. A new output aborts the prior controller and replaces `output.current`; the old playback rejection may settle later (e.g. asynchronously delivered Web Audio `ended` or response-reader cancellation). If the new output has already published a preview, the old catch clears that newer preview. If the workspace/session reset delivery history in the meantime, the same catch also adds the old speech to the new delivery context. The guarded `finally` does not protect the preceding catch.

Capture the session identity and check both that and output ownership before clearing shared presentation state or recording delivery, on success as well as failure. A regression should hold the old audio promise after abort, begin a new preview, then reject the old promise and assert that the new preview/delivery context survives.

### P2: Workspace replacement while microphone connection is pending does not end capture startup

Location: `src/features/voice/useVoiceSession.ts`, workspace subscription's `if (active.current) actions.current.end()` and `start`'s post-connect guard.

During `start`, `session.current` is set but `active.current` stays false until microphone/token/socket setup completes. Replacing/importing the workspace during that interval clears goal/deliveries but does not abort the connecting session. The post-connect guard checks only the controller/session identity, so it activates capture in the new workspace after the switch. `workspaceId` is assigned at start but is never checked. End connecting sessions on a workspace change as well, or include the captured workspace ID in the final connection validity check.

These follow-up findings were sent directly to the root agent. They are source-traced; no shared UI/browser runner was disturbed while the root agent was testing.

## Lifecycle re-review and resolution status

Re-read the current `useVoiceSession.ts`, `presentation.ts`, `playback.ts`, collaborator apply/cancel paths, updated transport, persistent controls, and new presentation/browser regressions after the root's fixes.

- **Resolved by source inspection:** old playback completion/rejection now checks captured session/output ownership before touching preview or delivery state; delivery is inserted synchronously at audio start and upgraded on successful completion. Old asynchronous cleanup cannot append to a reset delivery array.
- **Resolved by source inspection:** preview cleanup is job-scoped, uses its own cancellation identity, and disposes revision/abort callbacks. Successful approval retires the preview before publishing its canonical commit, avoiding a false manual-takeover event. Revision monitoring remains live while visual completion waits for audio. New `voice-presentation.test.ts` cases cover the main scenarios; root reports them passing.
- **Resolved for a different-workspace ID:** reset now ends a connecting session as well as a fully active session, and post-connect validity checks reject changed workspace identity. Root reports the connecting replacement browser regression passing. The same-ID import edge below remains.
- **Resolved by source inspection:** persistent Show target buttons and the notes rendered-preview presentation cover hidden destinations. Root reports the hidden-notes browser case passing. Text reveal now scrolls to the actual changed endpoint, with an offscreen append assertion in the browser test.
- **Resolved by source inspection:** muted/stale/aborted reconnect failures are ignored in transport. Root reports the transport cancellation regressions passing.
- **Board overlay:** full-scene replacement is being implemented and verified by the dedicated board agent; this lifecycle re-review does not claim its completion.

### Remaining P2: Typed questions bypass the voice session's goal and completion lifecycle

Locations: `src/features/ai/ChatPanel.tsx:129-133` and suggestion buttons around line 259; `src/features/voice/useVoiceSession.ts` goal assignment in `ask` and status transition in `hooks.play.finally`.

Chat sends typed prompts directly through `collaborator.ask`, while microphone utterances pass through the session's `ask`. A typed question during an active voice session still becomes a voice job (`voice.enabled` is true), but it never updates the session's remembered goal. Reproduce: speak task A, let it finish, type unrelated task B, pause its spoken response, then click Resume. The session constructs the resumed request with Previous request: A, explicitly returning to the stale spoken task instead of the latest typed question. Typed requests also have no session-level completion callback to move the status from `Thinking` (set by speech playback's finally block) back to `Listening`, so the controls can remain stuck on Thinking after the collaborator finishes. Route both input paths through a shared session-aware request lifecycle, or add collaborator request-start/end notifications without changing typed command semantics. Source-traced; sent to root for a mixed-input browser regression.

### Remaining P2: Same-ID imports bypass the workspace-change startup guard

Locations: `src/features/voice/useVoiceSession.ts` workspace subscription and `start` post-connect guard; `src/features/workspace/WorkspaceShell.tsx:341-344` import replacement; `src/features/workspace/model.ts:568-576` `validateImport` preserves workspace ID.

Exporting and reimporting the same workspace preserves `data.id`. If the exported copy contains messages, neither the ID-change condition nor the messages-becoming-empty condition fires. The import handler cancels the collaborator but does not end voice. A pending microphone connection can therefore finish after the imported copy replaces the workspace, and an already active session retains its pre-import goal/delivery records. The new browser test imports `createWorkspace()`, so it exercises only the different-ID case. Explicitly end/reset the voice session at the accepted import-replacement boundary (including connecting state), or introduce a replacement epoch checked by the session. Source-traced; no implementation edits made.

## Final mixed-input lifecycle resolutions

Root reports that WorkspaceShell now wraps the raw collaborator engine's ask with `voice.submit`, while `voice.bind` retains the raw engine to avoid recursion. Typed requests now participate in goal/status updates, and the mixed-input browser regression (typed follow-up, return to Listening, Resume latest task) passes. Accepted import replacement explicitly calls `voice.end()`, and end resets goal/delivery history; the same-ID connecting-import browser regression passes. These resolve the two remaining lifecycle findings from the prior pass. No further broad lifecycle review was requested.

The report was converted from Windows-1252 to UTF-8. The conversion verified equality of decoded content before and after encoding.

## Review of user-authorized partial-work checkpoints

The user explicitly changed interruption behavior to retain the exact partial text/stroke already written. Re-reviewed only the new checkpoint path (`checkpointPresentation`, session pause/end, `unfinishedGoal`, native board checkpoint geometry), without reopening the resolved earlier work.

Authorization and canonical-write path: presentation begins only after existing approval/auto-apply; checkpoint checks the active job, target revision, source revisions, and accepted-operation deduplication through `checkProposal`/`applyProposal`. It reuses the accepted operation ID, records one normal undoable change, and retires preview listeners before publishing that change. Pause then aborts output and cancels the collaborator synchronously, so late playback cannot apply the full proposal over the checkpoint. Checkpointing does not call Python execution, including an interrupted Apply & run. No blocker identified in those paths.

Two concrete new edges were sent to root:

- `checkpointPresentation` uses `current.elements` if this proposal has no `paintedBoard`. Native board exports run asynchronously at 15 fps, so a pause before first completed paint (or while the destination stays hidden) can persist a frame that was never displayed. For the exact visible-work contract, absence of a painted frame should retain canonical board data rather than the ahead-of-render frame.
- `hooks.play` clears `unfinishedGoal` after any successful edit. If task A is an interrupted function and clarification B writes a note, B's unrelated edit clears the reminder of A; Resume then chooses B. Clear it when the interrupted task is actually resumed/completed or explicitly replaced, not after any edited artifact completes.

A nonblocking targeted geometry check was also sent: partial arrows retain their final endBinding while their endpoint is truncated. The board agent should verify native bound-arrow reconciliation/movement does not extend that saved partial stroke unexpectedly, and detach an unfinished end if needed. This was not reproduced and is not claimed as a confirmed blocker.
