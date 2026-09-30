# Task 11 profiling baseline (September 28, 2026)

## Environment and method

- Windows 11 Home 10.0.26200, Intel Core Ultra 9 185H (16 cores, 22 logical processors), about 32 GB RAM, Node 25.1.0.
- Headless Chrome 153.0.8010.54, 1440 × 1000 viewport, reduced motion, Next.js 16.3.5 development server with Turbopack. Results are local development measurements, not production build or target-device timings.
- A Playwright init script installed a React DevTools hook before page load. On each commit it walked the Fiber tree and counted the `PerformedWork` flag for `WorkspaceShell`, `ChatPanel`, and `BoardEditor`. These are committed component render counts; they exclude discarded render attempts. The probe lives in ignored `.local/task11-browser-probe.mjs` during this work.
- Chat fixture: Settings supplied a fixture Gemini key; a browser-only fetch stub returned 20 NDJSON `text` events at 40 ms intervals and a `done` event. No provider call was made. Counts were reset just before Send and read after Stop disappeared.
- Drawing fixture: with chat open and the board ready, select Excalidraw Draw and make one freehand stroke with 20 pointer steps. Counts were reset immediately before pointer down and read after 750 ms. Export confirmed one saved element and board revision 22.

| Interaction | Shell before → after | Chat before → after | Board editor before → after | React commits before → after |
| --- | ---: | ---: | ---: | ---: |
| 20 streamed chat chunks | 24 → 1 | 25 → 24 | Not mounted | 27 → 27 |
| One 20-step freehand stroke | 24 → 2 | 24 → 0 | 24 → 22 | 71 → 68 |

A second baseline chat run gave 28 shell and 29 chat renders. Development scheduling changes the exact count. After selective subscriptions and stable child props, streamed text still renders ChatPanel as expected, while drawing no longer renders it. The same drawn element was saved at board revision 22 in both probes. The post-change probe passed thresholds of at most five shell renders per interaction and at most three chat renders during drawing. The browser probe was run red before the component edit and green afterward. Focused editor-layout, AI client, and workspace unit suites passed (57 tests); `npm run typecheck` passed.

## Save preparation

The CPU probe loads the real TypeScript `createWorkspace`, `validateWorkspace`, and `fitWorkspace` modules through Vite SSR without starting a web server. It measures `structuredClone(data)` followed by `fitWorkspace(...)`, the synchronous preparation performed by `saveWorkspace` before the ordered IndexedDB write. Seven iterations ran per fixture; the first two were discarded and the table reports the median of five. The probe lives in ignored `.local/task11-save-probe.mjs` during this work.

The small fixture has one 100,000-character encoded board file and a short message (100,555 serialized UTF-8 bytes). The near-limit fixture has two 4,000,000-character encoded board files, 40 accepted text changes with 180,000-character before/after snapshots, 60 linked source excerpts of 140,000 characters, and a short chat message. Its serialized size is 30,811,090 bytes (29.38 MiB) against the 32 MiB backup limit. The measured update adds one short assistant message; the board files remain unchanged. The synthetic file data passes the workspace schema but is not intended for image display.

| Fixture | Clone median | `fitWorkspace` median | Total median | Total sample range |
| --- | ---: | ---: | ---: | ---: |
| 0.10 MiB, chat update | 0.2 ms | 1.1 ms | 1.2 ms | 0.9–2.1 ms |
| 29.38 MiB, chat update | 60.6 ms | 172.8 ms | 233.3 ms | 217.7–243.6 ms |

An additional stage breakdown for the near-limit fixture found median times of 66.4 ms to clone, 25.8 ms to validate, 54.0 ms to stringify, and 95.6 ms to calculate serialized UTF-8 bytes using `Blob`. These are separate samples, so their medians do not have to sum to the table's total. IndexedDB transfer and write latency are not included.

The near-limit synchronous preparation is material relative to a 16.7 ms frame, even when only chat changes. Selector changes do not alter this save path, so this cost remains a concern. The fixture uses synthetic repeated data and excludes the browser's IndexedDB write. Before changing persistence, Task 11 needs a failing test for rapid chat updates with unchanged board assets that proves save ordering and recovery behavior. Coalescing pending writes may reduce redundant writes, but will not remove the synchronous clone/validation cost of each `saveWorkspace` call unless preparation itself is deferred or superseded.

## Large browser save after selector changes

A second browser probe used the same Windows/Chrome/Next development setup with a 28,715,113-byte (27.38 MiB) workspace. It contained two deterministic, valid 1000 × 1000 PNG files of 3,001,983 bytes each, both referenced by board elements; Chrome decoded one at the expected dimensions. It also contained 40 accepted note changes with retained snapshots and 45 linked source excerpts. The text in those records is synthetic, but the board assets and workspace structure are valid. The fixture was placed in this probe browser's IndexedDB, then the page reloaded and hydrated it. A stubbed 20-chunk chat answer changed messages while board assets remained unchanged.

An init script timed workspace `structuredClone` and instrumented the `idb-keyval` object-store `put` through transaction completion. It observed exactly one save after the trailing 450 ms debounce:

| Browser phase | Time |
| --- | ---: |
| Workspace `structuredClone` | 50.3 ms |
| Clone start to IndexedDB `put` (includes validation and serialization) | 538.0 ms |
| IndexedDB `put` to transaction completion | 217.2 ms |
| Clone start to transaction completion | 755.2 ms |

Chrome reported one 623 ms main-thread long task around save preparation. This one-flush result makes queue-only coalescing ineffective for the measured case.

## Worker save path after selector changes

`saveWorkspace` now posts its snapshot to a dedicated module Worker. The Worker validates, fits, and writes the same `ideate-workspace-v1` record through `idb-keyval`; it processes messages in order and acknowledges after the write finishes. Export, import, hydration, and corrupt-storage recovery still use the original record and validation contract. In Node tests, where `Worker` is unavailable, the existing synchronous save path remains.

The same 27.38 MiB browser fixture, Chrome setup, and 20-chunk chat update produced one save. Browser instrumentation timed `Worker.postMessage` on the main thread and the matching acknowledgment, then reread IndexedDB:

| Browser result | Before Worker | After Worker |
| --- | ---: | ---: |
| Main-thread snapshot send or clone | 50.3 ms explicit clone | 33.0 ms `postMessage` clone |
| Long task during save | 623 ms | None observed |
| Save start to IndexedDB completion / Worker acknowledgment | 755.2 ms | 1,136.8 ms |
| Saved board files | 2 | 2 |

The after-save record contained both board files and the new messages (28,717,610 serialized bytes). The Worker trades longer elapsed save time in this local development run for a much shorter main-thread interruption. The 33 ms send still exceeds a 16.7 ms frame. Tests cover rapid ordered chat saves with unchanged board assets, invalid data preserving the last valid record, worker crash and retry, and worker startup failure and retry. IndexedDB orders overlapping readwrite transactions by creation, so a transaction started by an old Worker must finish before a new Worker's later transaction to the same object store ([IndexedDB transaction scheduling](https://www.w3.org/TR/IndexedDB/#transaction-scheduling)).

No record split is justified by the current evidence: it would need atomic multi-record writes, migration, composite size accounting, and additional recovery rules. Revisit if the 33 ms send is material on target devices or larger valid workspaces.
