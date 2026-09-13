# SDD ledger — plan: docs/superpowers/plans/2026-09-13-voice-collaboration.md

Approved approach: live voice with progressive writing, both interrupted together. The user configured ElevenLabs credentials locally. Their updated interruption preference is implemented: retain exactly the displayed partial work as an undoable checkpoint, then answer and resume the unfinished task.

Tasks 1–5 are complete. Final verification: 252 unit tests, 7 voice browser cases, the extended clarification-and-resume browser case, all 13 existing collaboration/attention browser cases, and the production build passed. Live provider probes verified token, speech, and valid Gemini operations; actual-device microphone quality remains to be evaluated. See integration-report.md for evidence and limitations.

| Tasks | Shared surface | Review |
| --- | --- | --- |
| 1, 3 | speak(text, signal, onStart) | onStart means playback; completion means last sample played |
| 2, 3 | presentChange(proposal, preview, signal, durationMs) | previews do not commit; collaborator revalidates and commits |
| 3, 4 | collaborator voice hooks | one writer and one active turn |
| 2, 4 | preview cancellation | intentional interruption checkpoints displayed work; conflicts and failures discard stale previews |
| 1 | endpoint and transport contracts | current ElevenLabs docs must be checked before coding |
| 2 | partial display and persistence | pure frames separated from canonical workspace |
| 3 | paired operations | reuse existing validation; nested execution prohibited |
| 4 | media lifecycle | explicit start and visible controls; close releases resources |
| 5 | acceptance | fixture evidence separate from live quality |

Work in the existing feature checkout to preserve current editor integration. Stage only task-owned files; leave unrelated layout work untouched. New voice documents are scoped to the approved design.
