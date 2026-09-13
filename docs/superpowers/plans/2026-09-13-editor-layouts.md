# Editor Layouts Implementation Plan

> Execute the approved design in this session. Use test-first integration coverage and a code review before completion.

**Goal:** Add optional split, tabbed, floating, and maximized editors while retaining the current default.

**Architecture:** Dockview owns layout shells. Persistent React portal containers own editors independently of those shells. A layout controller handles mode changes, restoration, and visibility; the workspace store retains content, focus, and execution ownership.

**Tech Stack:** Next.js 16.3.5, React 19, Zustand, dockview-react 8.3.1, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-editor-layout-design.md`

## Global constraints

- Default single-editor appearance and Study Partner sidebar are preserved.
- One live instance of each editor; layout transitions preserve editor history and running code.
- Native browser popouts are excluded from this version.
- Respect existing uncommitted changes; do not stage unrelated work.
- Local Next.js client-component/lazy-loading docs have been read.

## Task 1: Integration contract

- [ ] Create `tests/e2e/editor-layout.spec.ts` using real Python/Journal/Whiteboard panels.
- [ ] Run `npx playwright test tests/e2e/editor-layout.spec.ts -g "splits"` and confirm the missing layout control fails.
- [ ] Add `tests/editor-layout.test.ts` for rejecting malformed persisted layout and focus/visibility behavior.

## Task 2: Layout and persistent editor hosts

- [ ] Add `src/features/workspace/layoutPersistence.ts` to read/write versioned layouts, rejecting unknown tools, duplicate IDs, external windows, and invalid geometry.
- [ ] Add `WorkspaceLayout.tsx`, `DockedEditors.tsx`, `LayoutControls.tsx`, and `WorkspaceLayout.module.css` to isolate persistence, Dockview commands, React hosts, and presentation.
- [ ] Replace the shell's three editor slots with `WorkspaceLayout` while leaving the desk and runner mounted at their existing scope.
- [ ] Add store visibility/focus/navigation state and update TextEditor activation and AI attention visibility.
- [ ] Use `createPortal(editor, stableHost, tool)` so Dockview removal/restoration does not destroy editor state.
- [ ] Add editor-container sizing and viewport refresh behavior where needed for moving/resizing real editors.

## Task 3: Verification and review

- [ ] Run the new unit and browser tests, then editor/attention regression tests.
- [ ] Inspect default, split, floating, and narrow-screen screenshots and fix layout problems.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Request a focused code review of new layout files and touched integration points; fix substantive findings.
- [ ] Record usage in README and report verified behavior plus any remaining limitations.
