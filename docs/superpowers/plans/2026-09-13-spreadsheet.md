# Spreadsheet Implementation Plan

**Goal:** Add a usable fourth editor and whiteboard/journal-to-spreadsheet AI workflow.

**Architecture:** Store a validated sparse sheet as a revisioned text artifact. A pure engine handles calculations; a client grid handles interaction; AI patches reuse existing proposal transactions.

**Tech Stack:** Next.js, React, TypeScript, Zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-spreadsheet-design.md`

## Constraints

Preserve existing uncommitted work. Read installed Next.js documentation. Limit sheets to A1:Z200, 5,000 populated cells and 200,000 serialized characters. No executable formula evaluation. Existing saves load an empty spreadsheet.

## Tasks

- [x] Engine: create `src/features/spreadsheet/sheet.ts` and `tests/spreadsheet.test.ts`; test dependent totals, ranges, percentage arithmetic, error propagation, cycles, bounds, formatting, serialization, CSV quoting. Run `npx vitest run tests/spreadsheet.test.ts` before and after implementation.
- [x] Grid: create `SpreadsheetPanel.tsx` and CSS module; integrate cell/formula edits, range clipboard, formatting, CSV, local undo, source selection and reveal. Test browser editing, calculation, reload and clipboard in `tests/e2e/spreadsheet.spec.ts`.
- [x] Workspace: extend model, store, layouts, desk navigation and clear controls with `spreadsheet`; default old saves to an empty text artifact and validate its serialized contents and history. Test migration, invalid imports, proposals, conflicts, undo and clearing in `tests/spreadsheet-workspace.test.ts`.
- [x] AI: extend tools, collaborator and prompt for bounded reads and address patches, including source revision tracking; render human-readable cell diffs in chat. Test source-to-sheet proposals and stale edits in `tests/spreadsheet-ai.test.ts`.
- [x] Integration: keep voice spreadsheet changes atomic; run typecheck, full unit suite, spreadsheet and related browser tests, production build. Review final diff and document supported formulas and workflow in README.

The independent engine, grid and AI tasks run concurrently; workspace integration and final verification run locally.

Final validation: production build and TypeScript passed; 299 unit tests passed across 34 files; 5 spreadsheet browser tests passed. Nine related navigation/control browser cases passed (one transient reload failure passed on isolated rerun). Desktop, split, narrow-screen, and relocated desk screenshots inspected. AI browser tests use deterministic provider fixtures; no live Gemini request was made. Review fixes cover ROUND argument positions, hash-prefixed text in aggregates, quoted TSV round trips, Unicode read budgets, and formatted-cell editing. Spreadsheet desk object and camera target sit above the journal as requested.
