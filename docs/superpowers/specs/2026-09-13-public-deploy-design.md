# Public deployment scale-down

Date: 2026-09-13
Branch: `feat/public-deploy` (from `feat/study-desk`, to be merged into `main`)

## Goal

Make Ideate deployable on a public URL that many strangers can use without
the operator paying for their AI usage or maintaining server-side user data.
Open straight into a working layout instead of the 3D desk.

## Non-goals

- Accounts, login, or cloud sync. Data stays in the visitor's browser
  (IndexedDB + localStorage), exactly as today.
- The Python runner (`runner/`, `src/features/execution`, `scripts/dev.mjs`).
  Another branch owns the runner's deployment story. This work does not
  touch those paths.
- Removing the 3D desk. It stays as an optional view.

## Changes

### 1. Bring-your-own-key (BYOK) for AI providers

**Storage.** A single localStorage entry `ideate:provider-keys:v1` holds
`{ version: 1, gemini: string, elevenLabsKey: string, elevenLabsVoiceId: string }`.
A new module `src/features/settings/providerKeys.ts` owns read/write/parse
and exposes `useProviderKeys()` (zustand) so the header and voice controls
react to changes. Keys are never written to IndexedDB, never included in
workspace export, and never sent to any origin other than the app's own
`/api/*` routes.

**Transport.** Every request to `/api/ai` carries `X-Gemini-Key`. Requests to
`/api/voice/session` and `/api/voice/speech` carry `X-ElevenLabs-Key` and
`X-ElevenLabs-Voice`. Headers are attached in the two existing fetch sites:
`request()` in `useCollaborator.ts` and `fetchScribeToken` / `speak` in
`voice/transport.ts`.

**Server.** `provider.ts` and `voice/server.ts` stop reading
`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID` from env.
They read the request headers instead. A missing or malformed header returns
`503` with a message telling the visitor to add a key in Settings. Header
values are validated as printable ASCII, 1 to 256 characters, and are never
logged, echoed, or stored. `GEMINI_MODEL` and `ELEVENLABS_TTS_MODEL` remain
operator env vars because they are not secrets.

There is no operator fallback key. If the header is absent the request fails
even when the env var happens to be set. `scripts/check-gemini.mjs` keeps
reading env because it is a local developer check, not a server path.

**Settings UI.** A gear button in the header opens a `<dialog>`
(`src/features/settings/SettingsDialog.tsx`) with:

- Gemini API key (password input, required for chat). Link to Google AI Studio.
- ElevenLabs API key and Voice ID (both optional). Short note that voice is
  off until both are set.
- A "Keys stay in this browser and are only sent to this site's own API"
  sentence.
- Save and Clear keys buttons.

**Degraded states.**

- No Gemini key: the study partner panel still opens but shows a setup card
  with an "Open settings" button instead of the composer. The voice
  microphone button is disabled with a tooltip explaining why.
- Gemini key but no ElevenLabs key/voice: `VoiceControls` renders only the
  chat toggle and stop button. The microphone button and status text are
  hidden. Chat works as text. `useVoiceSession.start()` refuses with a
  friendly error if called anyway.
- Both set: identical to today's behavior.

**Rate limiting.** The existing per-origin limiter and budget store in
`ai/server` stay. They protect the deployment from abuse, not the operator's
wallet, so they are unchanged.

### 2. Remove the Nessie bank import

Delete:

- `src/features/bank/**`
- `src/app/api/bank/**`
- `import_bank_data` from `ai/server/tools.ts` (schema, union member, name
  list, description) and the matching paragraph in `ai/server/prompt.ts`
- The `import_bank_data` dispatch branches and `runBankImport` in
  `useCollaborator.ts`
- The "Connect mock bank" button, `bank` state, and imports in
  `spreadsheet/SpreadsheetPanel.tsx`
- `tests/bank-*.test.ts` (five files)
- `docs/superpowers/specs/2026-09-13-nessie-bank-import-design.md`
- `NESSIE_API_KEY` from `.env.example`
- The `lucide-react` `Landmark` import if unused after removal

Any README or docs paragraph describing the bank feature is removed.

### 3. Remove the seeded binary search workspace

`createWorkspace()` in `workspace/model.ts` returns empty code and notes:

- `code.text` = `""`
- `notes.text` = `""`
- `title` = `"My workspace"`

`SAMPLE_CODE` is deleted. `docs/examples/binary-search-workspace.json` and
`docs/examples/README.md` are deleted. Tests and e2e specs that assert on
binary search text or rely on the seeded code to run something are updated
to type or import their own small snippet (`tests/ai-server-client.test.ts`,
`tests/e2e/{attention,story-updates,voice,workspace}.spec.ts`).

Empty editors show a one-line placeholder so a first visit does not look
broken. CodeMirror gets a placeholder extension (`# Write Python here, then
Ctrl+Enter to run`). The notes editor gets `Start writing…`. The spreadsheet
and whiteboard already handle empty state.

### 4. Workspace-first entry with layout presets

**Presets.** `src/features/workspace/presets.ts` defines:

| id | label | arrangement |
|----|-------|-------------|
| `code` | Code | Python with Output below |
| `notes` | Notes | Journal alone |
| `code-notes` | Code + Notes | Python left, Journal right, Output below Python |
| `everything` | Everything | Python, Journal, Whiteboard, Spreadsheet in a 2x2 grid |

A preset is a start tool plus an ordered list of `OpenEditor` commands
(`{ tool, placement, reference }`) that already drive `EditorDock.open`.
Presets are not stored dockview JSON, so they cannot drift with dockview
serialization changes.

**Applying.** `WorkspaceLayout` gains `applyPreset(id)`: it navigates to the
preset's start tool, enables the dock, initializes with the start tool, then
runs each open command in a single transaction. `EditorDock.initialize`
accepts an optional list of opens instead of a single `start`. After
applying, the normal capture/persist path saves the resulting arrangement as
the "previous arrangement" so manual tweaks are kept.

**Remembering.** `ideate:layout-preset:v1` stores the last applied preset id.
The header shows a preset picker: a labelled `<select>` placed before the
existing layout controls, so it stays compact on narrow headers. Choosing one
applies it and saves the id.

**Entry.** The store's initial `view` and `page` become the remembered
preset's start tool, defaulting to `code` on a first visit. On hydration,
`WorkspaceShell` applies the remembered preset once. `clearData("all")` now
returns to the default preset instead of the desk. The desk remains
reachable through the brand button, whose label changes from "Back to desk"
to "Desk". The `?view=desk` query parameter opens the desk directly for
anyone who wants to link to it.

Narrow screens (the existing `max-width: 800px` breakpoint) ignore presets
and show the single-editor view, as they do today.

### 5. Environment and docs

`.env.example` becomes:

```
GEMINI_MODEL=gemini-3.8-flash
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
NEXT_PUBLIC_RUNNER_ORIGIN=http://localhost:3001
```

`README.md` gets a short "Deploying" section: no secrets are required on
the server, visitors bring their own keys, and the runner origin is the one
thing to configure. `docs/architecture.md` and `docs/ai-collaboration.md`
are updated where they describe env keys, the bank import, or the desk as
the entry point.

## Data flow (BYOK)

```
Settings dialog ──save──▶ localStorage ideate:provider-keys:v1
                                   │
useCollaborator.request() ◀────────┤ read on each call
voice/transport fetches   ◀────────┘
        │  X-Gemini-Key / X-ElevenLabs-Key / X-ElevenLabs-Voice
        ▼
/api/ai, /api/voice/*  ── validate header, build provider client ──▶ Google / ElevenLabs
        (never logs or stores the header)
```

## Error handling

- Missing key header: `503 { type: "error", message: "Add your Gemini API key in Settings to chat." }`. The client shows the setup card.
- Provider rejects the key (401/403 upstream): existing mapping returns `503 "credentials were rejected"`. The client appends "Check your key in Settings."
- localStorage unavailable: settings save reports "Keys will be forgotten when this tab closes" and keeps them in memory for the session.

## Testing

Unit (vitest):

- `providerKeys.test.ts`: parse/serialize, rejects oversized or non-ASCII
  values, absent storage.
- `ai-server.test.ts` additions: header missing → 503, header present →
  passed to the provider factory, header never appears in logs or error
  bodies.
- `voice-server.test.ts` additions: same for both voice routes.
- `presets.test.ts`: every preset produces a dock state whose opened panels
  match its declaration.
- `workspace.test.ts`: `createWorkspace()` yields empty code and notes.
- Bank tests deleted; tools/prompt tests no longer list `import_bank_data`.

E2E (Playwright):

- First visit lands on the Code preset with Python and Output visible, no
  desk.
- Choosing "Code + Notes" shows both panes; reload keeps it.
- Chat without a key shows the setup card; adding a key in Settings enables
  the composer (mock `/api/ai`).
- Voice controls hidden without ElevenLabs settings; visible after adding
  them.
- `?view=desk` shows the desk.

## Out of scope for this spec

Runner deployment, accounts, removing three.js, and any model or prompt
changes beyond deleting the bank tool.
