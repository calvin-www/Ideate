# SDD ledger — plan: docs/superpowers/plans/2026-09-13-voice-collaboration.md

Approved approach: live voice with progressive writing, both interrupted together. User will add ElevenLabs credentials locally.

| Tasks | Shared surface | Review |
| --- | --- | --- |
| 1, 3 | speak(text, signal, onStart) | onStart means playback; completion means last sample played |
| 2, 3 | presentChange(proposal, preview, signal, durationMs) | previews do not commit; collaborator revalidates and commits |
| 3, 4 | collaborator voice hooks | one writer and one active turn |
| 2, 4 | preview cancellation | end, manual input, and interruption remove unfinished preview |
| 1 | endpoint and transport contracts | current ElevenLabs docs must be checked before coding |
| 2 | partial display and persistence | pure frames separated from canonical workspace |
| 3 | paired operations | reuse existing validation; nested execution prohibited |
| 4 | media lifecycle | explicit start and visible controls; close releases resources |
| 5 | acceptance | fixture evidence separate from live quality |

Work in the existing feature checkout to preserve current editor integration. Stage only task-owned files; leave unrelated layout work untouched. New voice documents are scoped to the approved design.
