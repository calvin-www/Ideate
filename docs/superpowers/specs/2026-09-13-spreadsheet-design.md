# Spreadsheet editor

Approved scope: a fourth editor for working through finances from whiteboard or journal material. A general-purpose grid supports manual changes, basic formulas, currency and percent formatting, rectangular clipboard operations, CSV export, local saves, and existing layouts. AI reads source artifacts and patches cells through the existing review/auto-apply, revision checks, and undo flow. Unknown amounts and periods must remain explicit rather than guessed.

The sheet is a sparse address-to-cell map serialized in a revisioned text artifact. This reuses the existing snapshot history without introducing a second persistence mechanism. Legacy workspaces default to an empty sheet. The pure sheet module validates all writes/imports, evaluates a bounded arithmetic grammar without JavaScript evaluation, and exports calculated values. Initial limits are 200 rows, 26 columns, 5,000 cells and 200,000 serialized characters.

The grid owns selection, keyboard editing, local undo and clipboard handling. It uses the workspace store for committed changes and registers the normal source-navigation adapter. AI reads return bounded cells with raw and calculated values; edits use explicit addresses and preserve untouched cells. Spreadsheet edits during voice are atomic so interrupted speech cannot leave invalid serialized data.

Verification covers formula dependency recalculation and errors, legacy imports, invalid sheets, AI transfers and revision conflicts, undo, persistence, desktop/mobile navigation, layout opening, and browser grid editing. Excel import, multiple sheets, charts, bank connections and full Excel compatibility are outside this version.
