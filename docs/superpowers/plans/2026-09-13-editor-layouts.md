# Editor Layouts Implementation Plan

> Execute the approved design in this session. Use test-first integration coverage and a code review before completion.

**Goal:** Add optional split, tabbed, floating, and maximized editors while retaining the current default. Each header page remembers its own arrangement and restores it when revisited.

**Architecture:** Dockview owns layout shells. Persistent React portal containers own editors independently of those shells. A layout controller handles mode changes, restoration, and visibility; the workspace store retains content, focus, and execution ownership.

**Tech Stack:** Next.js 16.3.5, React 19, Zustand, dockview-react 8.3.1, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-editor-layout-design.md`

## Global constraints

- Default single-editor appearance and Study Partner sidebar are preserved.
- Header page ownership is separate from panel focus. Single editor and Reset affect only the selected page.
- One live instance of each editor; layout transitions preserve editor history and running code.
- Native browser popouts are excluded from this version.
- Respect existing uncommitted changes; do not stage unrelated work.
- Local Next.js client-component/lazy-loading docs have been read.

## Task 1: Integration contract

- [x] Create `tests/e2e/editor-layout.spec.ts` using real Python/Journal/Whiteboard panels.
- [x] Verify a failing navigation regression before the fix, then confirm it passes.
- [x] Add `tests/editor-layout.test.ts` for rejecting malformed persisted layout and focus/visibility behavior.

## Task 2: Layout and persistent editor hosts

- [x] Add `src/features/workspace/layoutPersistence.ts` to read/write versioned layouts, rejecting unknown tools, duplicate IDs, external windows, and invalid geometry.
- [x] Add `WorkspaceLayout.tsx`, `DockedEditors.tsx`, `LayoutControls.tsx`, and `WorkspaceLayout.module.css` to isolate persistence, Dockview commands, React hosts, and presentation.
- [x] Replace the shell's three editor slots with `WorkspaceLayout` while leaving the desk and runner mounted at their existing scope.
- [x] Add store visibility/focus/navigation state and update TextEditor activation and AI attention visibility.
- [x] Use `createPortal(editor, stableHost, tool)` so Dockview removal/restoration does not destroy editor state.
- [x] Add editor-container sizing and viewport refresh behavior where needed for moving/resizing real editors.

## Task 3: Verification and review

- [x] Run the new unit and browser tests, then editor/attention regression tests.
- [x] Inspect default, split, floating, and narrow-screen screenshots and fix layout problems.
- [x] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [x] Request a focused code review of new layout files and touched integration points; fix substantive findings.
- [x] Record usage in README and report verified behavior plus any remaining limitations.

## Initial verification results

- Full unit suite: 22 files, 187 tests passed.
- Layout browser suite: 7 tests passed. After adding the narrow-window navigation regression and its fix, both navigation tests passed again.
- Existing workspace, attention, and board-image browser suites: 17 tests passed.
- Typecheck and production build passed. A subsequent typecheck encountered a newly added, unrelated `tests/voice-progression.test.ts` import of the missing `src/features/voice/progression` module; that concurrent work was left untouched.
- Focused code and browser review findings were addressed, including floating docking, restoring saved contents and geometry, compact controls, board keyboard focus, and theme selectors.
- Native browser popouts remain outside this version.

## Per-page layout follow-up

- Store separate browser preferences for Whiteboard, Computer, and Journal; migrate the legacy global preference to its first editor's page.
- Capture splits, tab selections, floating bounds, and detached Output before navigation. Restore each page automatically, including after reload, while keeping editor instances mounted.
- Preserve the selected panel when returning from Desk or clicking the current header page. Single editor and Reset return to that page's default editor.
- Explicit Show actions reveal the requested editor even when its saved layout has another tab selected; ordinary header navigation preserves that selection.
- Confirmed failing regressions before fixing lost split arrangements, Desk return changing the active panel, Reset displaying another page's editor, and Show leaving Python hidden.
- Focused code review and isolated browser follow-ups found no remaining blockers.
- Final verification: 23 layout/output/attention browser tests and 36 targeted unit tests passed. The existing five workspace browser tests, typecheck, and production build also passed.
