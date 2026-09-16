# Public Deployment Scale-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ideate deployable publicly with bring-your-own-key AI, no Nessie bank import, no seeded binary-search workspace, and a workspace-first entry with named layout presets.

**Architecture:** Provider keys live in one localStorage entry owned by a small zustand store and travel to the app's own `/api/*` routes as request headers; the server reads headers instead of env. Layout presets are ordered `OpenEditor` commands applied through the existing `EditorDock`, and the workspace store's hydration accepts an entry view so the first render lands on the remembered preset. Everything else is deletion.

**Tech Stack:** Next.js App Router, React 19, zustand, dockview-react, CodeMirror 6, vitest 4, Playwright 1.63, `@google/genai`.

**Spec:** `docs/superpowers/specs/2026-09-13-public-deploy-design.md`

## Global Constraints

- Branch: `feat/public-deploy` (already created from `feat/study-desk`). Commit after each task.
- Do NOT modify `runner/**`, `src/features/execution/**`, or `scripts/dev.mjs`. Another branch owns them.
- No operator fallback key: the server must never read `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, or `ELEVENLABS_VOICE_ID`. `GEMINI_MODEL` and `ELEVENLABS_TTS_MODEL` stay as env.
- Key header names: `X-Gemini-Key`, `X-ElevenLabs-Key`, `X-ElevenLabs-Voice`. Header values: printable ASCII, 1 to 256 chars, regex `/^[\x21-\x7e]{1,256}$/`.
- localStorage keys: `ideate:provider-keys:v1`, `ideate:layout-preset:v1`.
- Keys are never logged, echoed in error bodies, persisted to IndexedDB, or included in workspace export.
- Preset ids: `code`, `notes`, `code-notes`, `everything`. Default `code`.
- Run from repo root on Windows Git Bash: `npx vitest run <file>` for unit tests, `npm run typecheck` for types, `npx playwright test <file>` for e2e (needs `npm run dev` running or lets Playwright start it).
- Line endings: files use LF; git may warn about CRLF. Ignore the warning.

---

### Task 1: Remove the Nessie bank import

**Files:**
- Delete: `src/features/bank/` (entire directory), `src/app/api/bank/` (entire directory), `tests/bank-ai.test.ts`, `tests/bank-live.manual.test.ts`, `tests/bank-normalize.test.ts`, `tests/bank-server.test.ts`, `tests/bank-sheet.test.ts`, `docs/superpowers/specs/2026-09-13-nessie-bank-import-design.md`
- Modify: `src/features/ai/server/tools.ts`, `src/features/ai/server/prompt.ts`, `src/features/ai/useCollaborator.ts`, `src/features/spreadsheet/SpreadsheetPanel.tsx`, `.env.example`, `README.md`

**Interfaces:**
- Produces: `toolNames` no longer contains `"import_bank_data"`. Nothing else changes shape.

- [ ] **Step 1: Delete the bank feature and its tests**

```bash
git rm -r -q src/features/bank src/app/api/bank tests/bank-ai.test.ts tests/bank-live.manual.test.ts tests/bank-normalize.test.ts tests/bank-server.test.ts tests/bank-sheet.test.ts docs/superpowers/specs/2026-09-13-nessie-bank-import-design.md
```

- [ ] **Step 2: Remove the tool from `src/features/ai/server/tools.ts`**

Delete these three things:

1. The schema line inside `workspaceToolSchemas`:
```ts
  import_bank_data: z.strictObject({ baseRevision: revision, summary }),
```
2. The union member inside `teach_step`'s `operation` discriminated union:
```ts
      z.strictObject({ name: z.literal("import_bank_data"), args: workspaceToolSchemas.import_bank_data }),
```
3. The `"import_bank_data",` entry in the `toolNames` array, and the whole `import_bank_data:` entry (one long string) in the `descriptions` record.

- [ ] **Step 3: Remove the bank paragraph from `src/features/ai/server/prompt.ts`**

Delete the paragraph that starts with `import_bank_data connects a mock bank:` (it is a single line around line 22) and the blank line after it.

- [ ] **Step 4: Remove bank code from `src/features/ai/useCollaborator.ts`**

1. Delete imports:
```ts
import { bankSnapshotToSheet } from "../bank/toSheet";
import type { BankSnapshot } from "../bank/types";
```
2. In `stage()`, change the `target` expression to:
```ts
    const target = (
      call.name === "link_artifacts"
        ? call.args.target
        : call.name.replace("edit_", "")
    ) as Tool;
```
3. In `stage()`'s `replacements` ternary, delete the branch:
```ts
                : call.name === "import_bank_data"
                  ? [{ from: 0, to: data.spreadsheet.text.length, text: String(call.args.sheetText) }]
```
4. Delete the whole `importBank` function (from the comment `// Fetch the mock bank snapshot` through its closing brace).
5. In `executeCall()`, delete:
```ts
    } else if (call.name === "import_bank_data") {
      result = await importBank(job, call);
```

- [ ] **Step 5: Remove the button from `src/features/spreadsheet/SpreadsheetPanel.tsx`**

1. Change the lucide import to `import { Download, Redo2, Undo2 } from "lucide-react";` and delete the two `../bank/` imports.
2. Delete the `const [bank, setBank] = useState(...)` line.
3. In the `useEffect` that resets history, delete `setBank((state) => state.status ? { ...state, status: "" } : state);`.
4. Delete the whole `connectBank` function and its leading comment block.
5. Delete the `<button onClick={connectBank} ...>Connect mock bank</button>` element.
6. Delete `{bank.status && <p className={styles.status} role="status">{bank.status}</p>}`.

- [ ] **Step 6: Remove env and README references**

In `.env.example` delete the two `NESSIE` lines (the comment and `NESSIE_API_KEY=`).

In `README.md` delete the whole `## Connect a mock bank` section (heading and its two paragraphs) and in the spreadsheet paragraph change `It does not import Excel files or connect to real banks.` to `It does not import Excel files.`

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck passes; all remaining tests pass. If `tests/spreadsheet-ai.test.ts` or `tests/ai-server.test.ts` list tool names, update the expected arrays to drop `import_bank_data`.

- [ ] **Step 8: Commit**

```bash
git add -A src tests docs .env.example README.md
git commit -m "Remove Nessie bank import

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Remove the seeded binary-search workspace

**Files:**
- Modify: `src/features/workspace/model.ts`, `src/features/board/adapter.ts`, `src/features/board/BoardEditor.tsx`, `src/features/ai/ChatPanel.tsx`, `src/features/ai/server/prompt.ts`, `src/features/workspace/TextEditor.tsx`, `tests/workspace.test.ts`, `tests/board-adapter.test.ts`, `tests/e2e/workspace.spec.ts`, `tests/e2e/story-updates.spec.ts`, `tests/e2e/attention.spec.ts`, `tests/e2e/voice.spec.ts`, `README.md`, `docs/implementation-status.md`
- Delete: `docs/examples/`

**Interfaces:**
- Produces: `createWorkspace()` returns `code.text === ""`, `notes.text === ""`, `title === "My workspace"`. `SAMPLE_CODE` and `sampleBoard` no longer exist.

- [ ] **Step 1: Write the failing unit test**

Append to `tests/workspace.test.ts` inside the existing `describe("workspace edit boundaries"`:

```ts
  it("starts empty with no seeded example", () => {
    const data = createWorkspace();
    expect(data.title).toBe("My workspace");
    expect(data.code.text).toBe("");
    expect(data.notes.text).toBe("");
    expect(data.board.elements).toEqual([]);
    expect(data.spreadsheet.text).toBe("");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/workspace.test.ts -t "starts empty"`
Expected: FAIL, `code.text` contains `binary_search`.

- [ ] **Step 3: Empty the seed in `src/features/workspace/model.ts`**

Delete the `export const SAMPLE_CODE = ...` line. Replace `createWorkspace` with:

```ts
export function createWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: "My workspace",
    code: { id: "code", revision: 0, text: "" },
    notes: { id: "notes", revision: 0, text: "" },
    board: { id: "board", revision: 0, elements: [], files: {} },
    spreadsheet: { id: "spreadsheet", revision: 0, text: "" },
    runs: [],
    messages: [],
    changes: [],
    references: [],
    acceptedOperations: [],
    updatedAt: Date.now(),
  };
}
```

Then run `grep -rn "SAMPLE_CODE" src tests` and fix any importer (expected: none).

- [ ] **Step 4: Remove `sampleBoard`**

In `src/features/board/adapter.ts` delete the whole `export async function sampleBoard()` function (line ~486 to the end of its closing brace). In `src/features/board/BoardEditor.tsx` delete the line `import { sampleBoard } from "./adapter";`.

In `tests/board-adapter.test.ts`: remove `window.sampleBoard = module.sampleBoard;` from the evaluate string near line 47, and rewrite the test near line 547 so it builds its own elements:

```ts
  it("normalizes imported array diagrams without changing IDs or their source snapshot", async () => {
    const result = await page.evaluate(async () => {
      const api = window as unknown as {
        buildBoardPatch: (
          elements: BoardElement[],
          patch: { additions: Record<string, unknown>[] },
        ) => Promise<BoardElement[]>;
        normalizeBoardImport: (
          elements: BoardElement[],
        ) => Promise<BoardElement[]>;
      };
      const elements = await api.buildBoardPatch([], {
        additions: [2, 5, 8, 12, 16, 23, 38, 56].map((n, i) => ({
          type: "rectangle",
          x: 90 + i * 82,
          y: 150,
          width: 70,
          height: 50,
          text: String(n),
        })),
      });
      const before = JSON.stringify(elements);
      const normalized = await api.normalizeBoardImport(elements);
      return {
        beforeIds: elements.map((element) => element.id),
        afterIds: normalized.map((element) => element.id),
        labels: normalized
          .filter((element) => element.type === "text")
          .map((element) => element.text),
        untouched: before === JSON.stringify(elements),
      };
    });
```
Keep the existing `expect` lines below it unchanged.

- [ ] **Step 5: Remove the binary-search copy in chat and prompt**

In `src/features/ai/ChatPanel.tsx` change the starter question `"Help me understand binary search"` to `"Help me plan what to build"`.

In `src/features/ai/server/prompt.ts` delete the paragraph that starts `For binary search, connect the low/high boundary` and its trailing blank line.

- [ ] **Step 6: Add editor placeholders in `src/features/workspace/TextEditor.tsx`**

Change the `@codemirror/view` import to:
```ts
import { Decoration, EditorView, placeholder } from "@codemirror/view";
```
Add `placeholder("# Write Python here, then press Ctrl+Enter to run")` as the last entry of the `pythonExtensions` array and `placeholder("Start writing…")` as the last entry of `noteExtensions`.

- [ ] **Step 7: Update unit and e2e tests that relied on the seed**

`tests/e2e/workspace.spec.ts`:
- In the test `binary search executes its real found and missing-target paths`, rename it to `a typed program executes and reruns after an edit` and replace the body up to `const original = ...` with:
```ts
  await openWorkspace(page);
  await navigate(page, "Computer");
  await editDocument(
    page,
    "code",
    "values = [2, 5, 8, 12, 16]\ntarget = 16\nprint(f\"Found at index {values.index(target)}\" if target in values else \"Not found\")\n",
  );
  await runPython(page);
  const output = pythonPanel(page).getByLabel("Python output", { exact: true });
  await expect(output).toContainText("Found at index 4", { timeout: 30_000 });
```
  Delete the three `low=... high=...` expectations. Keep the rest (the `target = 17` edit and `Not found` assertions) as is.
- Delete the whole test `the binary-search board example is included in exports and survives reload`.

`tests/e2e/story-updates.spec.ts` (test around line 200): replace the `Load binary search example` click and the following `expect.poll(...board.elements.length).toBeGreaterThan(0)` with drawing nothing; instead assert on code. Change the setup to:
```ts
  await navigate(page, "Computer");
  await editCode(page, "print('seeded by test')");
  await navigate(page, "Whiteboard");
```
  and change both `expect(data.code.text).toContain("binary_search");` lines to `expect(data.code.text).toContain("seeded by test");`. Remove the `expect(data.board.elements).toEqual([]);` line only if the board was never drawn on (it stays valid, keep it).

`tests/e2e/attention.spec.ts` (around line 375): the fixture highlights two rectangles. Replace the `Load binary search example` click with an import of a two-rectangle board via the existing `editDocument`/snapshot helpers if present in that file; if not, add before `await ask(page);`:
```ts
  await page.evaluate(async () => {
    const { useWorkspace } = await import("/src/features/workspace/store.ts");
    const { buildBoardPatch } = await import("/src/features/board/adapter.ts");
    const elements = await buildBoardPatch([], {
      additions: [
        { type: "rectangle", x: 100, y: 100, width: 80, height: 60, text: "12" },
        { type: "rectangle", x: 200, y: 100, width: 80, height: 60, text: "16" },
      ],
    });
    useWorkspace.getState().setBoard(elements);
  });
```
  (The `/src/...` import form is already used by `tests/board-adapter.test.ts`, so Vite dev serves it.)

`tests/e2e/voice.spec.ts`: at line ~177 replace the `Load binary search example` click with the same `page.evaluate` board seeding block as above (the test updates and deletes elements by id from the fixture, which reads the board). At line ~210 delete the `toBeVisible` expectation on the example button. Leave the spoken phrase "Show me binary search." alone; it is just a transcript string.

`tests/ai-server-client.test.ts`: the two prompts mentioning binary search are user text, not seed data. Leave them.

- [ ] **Step 8: Delete the example workspace and docs references**

```bash
git rm -r -q docs/examples
```
In `README.md`: replace step 1 of "Try the study loop" with `1. Draw an idea on the whiteboard, or type a small Python program.` and step 4 with `4. Change an input value and compare the actual traces.`; in step 3 delete the sentence `The prepared Python example also runs without AI.`; delete the sentence starting `A [prepared example](docs/examples/README.md)` near the end. In `docs/implementation-status.md` delete the paragraph starting `A [prepared study workspace](examples/README.md)`.

- [ ] **Step 9: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: pass, including the new "starts empty" test.

Run: `npx playwright test tests/e2e/workspace.spec.ts`
Expected: pass. (Other e2e files are re-verified in Task 10 after the entry-flow change lands, because they navigate through the desk.)

- [ ] **Step 10: Commit**

```bash
git add -A src tests docs README.md
git commit -m "Remove the seeded binary search workspace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Provider key store

**Files:**
- Create: `src/features/settings/providerKeys.ts`, `tests/provider-keys.test.ts`

**Interfaces:**
- Produces:
```ts
export type ProviderKeys = { gemini: string; elevenLabsKey: string; elevenLabsVoiceId: string };
export const PROVIDER_KEYS_STORAGE_KEY = "ideate:provider-keys:v1";
export const KEY_PATTERN: RegExp;                       // /^[\x21-\x7e]{1,256}$/
export function parseProviderKeys(raw: string | null): ProviderKeys;   // never throws
export function readProviderKeys(): ProviderKeys;       // from localStorage, safe on SSR
export function hasVoiceKeys(keys: ProviderKeys): boolean;
export const useProviderKeys: zustand store {
  keys: ProviderKeys; hydrated: boolean; settingsOpen: boolean; storageWarning: string;
  hydrate(): void; save(keys: ProviderKeys): void; clear(): void;
  openSettings(): void; closeSettings(): void;
}
export function keyHeaders(keys: ProviderKeys): Record<string, string>; // only present keys
```

- [ ] **Step 1: Write the failing tests**

Create `tests/provider-keys.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_KEYS_STORAGE_KEY,
  hasVoiceKeys,
  keyHeaders,
  parseProviderKeys,
  useProviderKeys,
} from "../src/features/settings/providerKeys";

const empty = { gemini: "", elevenLabsKey: "", elevenLabsVoiceId: "" };

// Tests run in Node (see vitest.config.ts); stub storage the same way
// tests/partner-defaults.test.ts does.
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("provider keys", () => {
  beforeEach(() => {
    useProviderKeys.setState({ keys: empty, hydrated: false, settingsOpen: false, storageWarning: "" });
  });

  it("parses stored keys and rejects anything malformed", () => {
    expect(parseProviderKeys(null)).toEqual(empty);
    expect(parseProviderKeys("not json")).toEqual(empty);
    expect(parseProviderKeys(JSON.stringify({ version: 2, gemini: "abc" }))).toEqual(empty);
    expect(
      parseProviderKeys(JSON.stringify({ version: 1, gemini: "AIza-1", elevenLabsKey: "el", elevenLabsVoiceId: "v1" })),
    ).toEqual({ gemini: "AIza-1", elevenLabsKey: "el", elevenLabsVoiceId: "v1" });
    expect(parseProviderKeys(JSON.stringify({ version: 1, gemini: "has space" }))).toEqual(empty);
    expect(parseProviderKeys(JSON.stringify({ version: 1, gemini: "x".repeat(257) }))).toEqual(empty);
    expect(parseProviderKeys(JSON.stringify({ version: 1, gemini: "ключ" }))).toEqual(empty);
  });

  it("saves to localStorage and hydrates back", () => {
    useProviderKeys.getState().save({ gemini: "g", elevenLabsKey: "", elevenLabsVoiceId: "" });
    expect(JSON.parse(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY)!)).toEqual({
      version: 1, gemini: "g", elevenLabsKey: "", elevenLabsVoiceId: "",
    });
    useProviderKeys.setState({ keys: empty, hydrated: false });
    useProviderKeys.getState().hydrate();
    expect(useProviderKeys.getState().keys.gemini).toBe("g");
    expect(useProviderKeys.getState().hydrated).toBe(true);
    useProviderKeys.getState().clear();
    expect(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY)).toBeNull();
    expect(useProviderKeys.getState().keys).toEqual(empty);
  });

  it("builds headers only for present keys and reports voice readiness", () => {
    expect(keyHeaders(empty)).toEqual({});
    expect(keyHeaders({ gemini: "g", elevenLabsKey: "e", elevenLabsVoiceId: "v" })).toEqual({
      "X-Gemini-Key": "g", "X-ElevenLabs-Key": "e", "X-ElevenLabs-Voice": "v",
    });
    expect(hasVoiceKeys(empty)).toBe(false);
    expect(hasVoiceKeys({ ...empty, elevenLabsKey: "e" })).toBe(false);
    expect(hasVoiceKeys({ ...empty, elevenLabsKey: "e", elevenLabsVoiceId: "v" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/provider-keys.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/features/settings/providerKeys.ts`**

```ts
"use client";
import { create } from "zustand";

export type ProviderKeys = {
  gemini: string;
  elevenLabsKey: string;
  elevenLabsVoiceId: string;
};
export const PROVIDER_KEYS_STORAGE_KEY = "ideate:provider-keys:v1";
export const KEY_PATTERN = /^[\x21-\x7e]{1,256}$/;
const EMPTY: ProviderKeys = { gemini: "", elevenLabsKey: "", elevenLabsVoiceId: "" };

function field(value: unknown): string | null {
  if (value === undefined || value === "") return "";
  return typeof value === "string" && KEY_PATTERN.test(value) ? value : null;
}

/** Malformed storage yields empty keys rather than a crash or a partial key. */
export function parseProviderKeys(raw: string | null): ProviderKeys {
  if (!raw || raw.length > 2000) return { ...EMPTY };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || value.version !== 1) return { ...EMPTY };
    const gemini = field(value.gemini);
    const elevenLabsKey = field(value.elevenLabsKey);
    const elevenLabsVoiceId = field(value.elevenLabsVoiceId);
    if (gemini === null || elevenLabsKey === null || elevenLabsVoiceId === null) return { ...EMPTY };
    return { gemini, elevenLabsKey, elevenLabsVoiceId };
  } catch {
    return { ...EMPTY };
  }
}

export function readProviderKeys(): ProviderKeys {
  try {
    if (typeof localStorage === "undefined") return { ...EMPTY };
    return parseProviderKeys(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY));
  } catch {
    return { ...EMPTY };
  }
}

export const hasVoiceKeys = (keys: ProviderKeys): boolean =>
  Boolean(keys.elevenLabsKey && keys.elevenLabsVoiceId);

export function keyHeaders(keys: ProviderKeys): Record<string, string> {
  const headers: Record<string, string> = {};
  if (keys.gemini) headers["X-Gemini-Key"] = keys.gemini;
  if (keys.elevenLabsKey) headers["X-ElevenLabs-Key"] = keys.elevenLabsKey;
  if (keys.elevenLabsVoiceId) headers["X-ElevenLabs-Voice"] = keys.elevenLabsVoiceId;
  return headers;
}

type Store = {
  keys: ProviderKeys;
  hydrated: boolean;
  settingsOpen: boolean;
  storageWarning: string;
  hydrate: () => void;
  save: (keys: ProviderKeys) => void;
  clear: () => void;
  openSettings: () => void;
  closeSettings: () => void;
};

export const useProviderKeys = create<Store>((set) => ({
  keys: { ...EMPTY },
  hydrated: false,
  settingsOpen: false,
  storageWarning: "",
  hydrate: () => set({ keys: readProviderKeys(), hydrated: true }),
  save: (keys) => {
    const clean = parseProviderKeys(JSON.stringify({ version: 1, ...keys }));
    try {
      localStorage.setItem(PROVIDER_KEYS_STORAGE_KEY, JSON.stringify({ version: 1, ...clean }));
      set({ keys: clean, storageWarning: "" });
    } catch {
      set({ keys: clean, storageWarning: "Keys will be forgotten when this tab closes. Your browser could not save them." });
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(PROVIDER_KEYS_STORAGE_KEY);
    } catch {
      /* Nothing stored to remove. */
    }
    set({ keys: { ...EMPTY }, storageWarning: "" });
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/provider-keys.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/providerKeys.ts tests/provider-keys.test.ts
git commit -m "Add browser-side provider key store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: AI server reads the Gemini key from the request

**Files:**
- Modify: `src/features/ai/server/validation.ts`, `src/features/ai/server/provider.ts`, `src/features/ai/server/handler.ts`
- Test: `tests/ai-server.test.ts`, `tests/ai-server-stream.test.ts`

**Interfaces:**
- Produces:
```ts
// validation.ts
export const PROVIDER_KEY_PATTERN = /^[\x21-\x7e]{1,256}$/;
export function readProviderKey(request: Request, header: string): string | undefined; // throws AiRequestError(400) when present but malformed
// provider.ts
export type GenerateStream = (contents: Content[], signal: AbortSignal, recovery?: boolean, apiKey?: string) => Promise<AsyncIterable<GenerateContentResponse>>;
```
- Behavior: `handleAiRequest` reads `X-Gemini-Key` and passes it as the fourth argument to `generate`. The real `generateStream` throws `AiRequestError(503, "Add your Gemini API key in Settings to chat.")` when `apiKey` is empty.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ai-server.test.ts` inside `describe("AI request boundary"`:

```ts
  it("reads a well-formed provider key header and rejects malformed ones", () => {
    const withKey = new Request("http://localhost:3000/api/ai", {
      headers: { "X-Gemini-Key": "AIza-example_123" },
    });
    expect(readProviderKey(withKey, "X-Gemini-Key")).toBe("AIza-example_123");
    expect(
      readProviderKey(new Request("http://localhost:3000/api/ai"), "X-Gemini-Key"),
    ).toBeUndefined();
    expect(() =>
      readProviderKey(
        new Request("http://localhost:3000/api/ai", {
          headers: { "X-Gemini-Key": "x".repeat(257) },
        }),
        "X-Gemini-Key",
      ),
    ).toThrow(AiRequestError);
  });
```
Add `readProviderKey` to the import list from `../src/features/ai/server/validation`.

Append to `tests/ai-server-stream.test.ts` inside `describe("AI streaming endpoint"`:

```ts
  it("passes the visitor's Gemini key to the provider and never echoes it", async () => {
    const seen: (string | undefined)[] = [];
    const keyed = new Request(request(), { headers: { ...Object.fromEntries(request().headers), "X-Gemini-Key": "visitor-key" } });
    const response = await handleAiRequest(keyed, {
      generate: async (_contents, _signal, _recovery, apiKey) => {
        seen.push(apiKey);
        return (async function* () {
          yield chunk({ candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" }] });
        })();
      },
    });
    const text = await response.text();
    expect(seen).toEqual(["visitor-key"]);
    expect(text).not.toContain("visitor-key");
  });

  it("refuses without a key before contacting Gemini", async () => {
    const response = await handleAiRequest(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ type: "error", message: "Add your Gemini API key in Settings to chat." });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ai-server.test.ts tests/ai-server-stream.test.ts`
Expected: FAIL: `readProviderKey` is not exported; the no-key test gets a different 503 message.

- [ ] **Step 3: Add `readProviderKey` to `src/features/ai/server/validation.ts`**

Append after `validateOrigin`:

```ts
export const PROVIDER_KEY_PATTERN = /^[\x21-\x7e]{1,256}$/;

/** Visitor-supplied provider credentials. Absent is allowed; malformed is not. */
export function readProviderKey(
  request: Request,
  header: string,
): string | undefined {
  const value = request.headers.get(header);
  if (value === null || value === "") return undefined;
  if (!PROVIDER_KEY_PATTERN.test(value))
    throw new AiRequestError(400, `The ${header} header is not a valid API key.`);
  return value;
}
```

- [ ] **Step 4: Update `src/features/ai/server/provider.ts`**

Change the type and the function head:

```ts
export type GenerateStream = (
  contents: Content[],
  signal: AbortSignal,
  recovery?: boolean,
  apiKey?: string,
) => Promise<AsyncIterable<GenerateContentResponse>>;

export const generateStream: GenerateStream = async (
  contents,
  signal,
  recovery,
  apiKey,
) => {
  if (!apiKey)
    throw new AiRequestError(
      503,
      "Add your Gemini API key in Settings to chat.",
    );
  const client = new GoogleGenAI({ apiKey });
```
Remove the old `const apiKey = process.env.GEMINI_API_KEY;` line. The rest of the function is unchanged.

- [ ] **Step 5: Thread the key through `src/features/ai/server/handler.ts`**

Add `readProviderKey` to the import from `./validation`. Immediately after `validateOrigin(request);` add:

```ts
    const apiKey = readProviderKey(request, "X-Gemini-Key");
```
Change the `openGeneration` call to pass it:

```ts
      const provider = await (dependencies.generate ?? generateStream)(
        contents,
        signal,
        recovery,
        apiKey,
      );
```
Confirm that no `console.*` call in `handler.ts` includes `apiKey` or request headers (the `[ai-usage]` log only reports model and token counts; leave it).

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/ai-server.test.ts tests/ai-server-stream.test.ts tests/ai-recovery.test.ts tests/ai-budget-integration.test.ts`
Expected: PASS. Existing tests inject `generate` and ignore the new argument.

- [ ] **Step 7: Commit**

```bash
git add src/features/ai/server tests/ai-server.test.ts tests/ai-server-stream.test.ts
git commit -m "Read the Gemini key from the request instead of env

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Voice server reads ElevenLabs credentials from the request

**Files:**
- Modify: `src/features/voice/server.ts`
- Test: `tests/voice-server.test.ts`

**Interfaces:**
- Produces: `requestConfig(request: Request): VoiceServerConfig | null` (exported, null when a header is missing or malformed). `dependencies.config` still overrides for tests. Error message when missing: `"Add your ElevenLabs API key and voice ID in Settings to use voice."`

- [ ] **Step 1: Update the setup-error test and add a header test**

In `tests/voice-server.test.ts`, in the test `returns actionable setup errors without calling ElevenLabs`, replace both expected error strings with `"Add your ElevenLabs API key and voice ID in Settings to use voice."`. Also change the `deps(upstream, { apiKey: "", voiceId: "", ttsModel: "" })` arguments in that test to `deps(upstream, undefined)` so the handler falls back to reading headers (and finds none). Update `deps` so `undefined` is passed through:

```ts
function deps(
  fetchImpl: typeof fetch,
  config: VoiceServerDependencies["config"] | undefined = configured,
): VoiceServerDependencies {
  return { fetch: fetchImpl, ...(config ? { config } : {}), timeoutMs: 1_000 };
}
```

Add a new test inside the same `describe`:

```ts
  it("uses the visitor's ElevenLabs headers for the token request", async () => {
    const upstream = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      return Response.json({ token: `for:${headers.get("xi-api-key")}` });
    });
    const request = new Request(`${origin}/api/voice/session`, {
      method: "POST",
      headers: { origin, "X-ElevenLabs-Key": "visitor-el", "X-ElevenLabs-Voice": "voice-1" },
    });
    const response = await handleVoiceSession(request, { fetch: upstream, timeoutMs: 1_000 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "for:visitor-el" });
  });

  it("rejects malformed credential headers without calling ElevenLabs", async () => {
    const upstream = vi.fn<typeof fetch>();
    const request = new Request(`${origin}/api/voice/session`, {
      method: "POST",
      headers: { origin, "X-ElevenLabs-Key": "has space", "X-ElevenLabs-Voice": "voice-1" },
    });
    const response = await handleVoiceSession(request, { fetch: upstream, timeoutMs: 1_000 });
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/voice-server.test.ts`
Expected: FAIL on the message text and the header test.

- [ ] **Step 3: Replace `environmentConfig` in `src/features/voice/server.ts`**

Replace the `environmentConfig` function with:

```ts
const CREDENTIAL_PATTERN = /^[\x21-\x7e]{1,256}$/;
const SETUP_MESSAGE =
  "Add your ElevenLabs API key and voice ID in Settings to use voice.";

/** Visitor credentials arrive per request; the server keeps none. */
export function requestConfig(request: Request): VoiceServerConfig | null {
  const apiKey = request.headers.get("x-elevenlabs-key") ?? "";
  const voiceId = request.headers.get("x-elevenlabs-voice") ?? "";
  if (!CREDENTIAL_PATTERN.test(apiKey) || !CREDENTIAL_PATTERN.test(voiceId))
    return null;
  return {
    apiKey,
    voiceId,
    ttsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
  };
}
```

In `handleVoiceSession` replace:
```ts
  const config = dependencies.config ?? environmentConfig();
  if (!config.apiKey || !config.voiceId) {
    return jsonError(503, "Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env.local, then restart the server.");
  }
```
with:
```ts
  const config = dependencies.config ?? requestConfig(request);
  if (!config || !config.apiKey || !config.voiceId) {
    return jsonError(503, SETUP_MESSAGE);
  }
```
In `handleVoiceSpeech` replace the equivalent block with:
```ts
  const config = dependencies.config ?? requestConfig(request);
  if (!config || !config.apiKey || !config.voiceId || !config.ttsModel) {
    return jsonError(503, SETUP_MESSAGE);
  }
```
Run `grep -n "ELEVENLABS_API_KEY\|ELEVENLABS_VOICE_ID" src` and confirm no matches remain.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/voice-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/voice/server.ts tests/voice-server.test.ts
git commit -m "Read ElevenLabs credentials from the request instead of env

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Client sends keys and voice refuses to start without them

**Files:**
- Modify: `src/features/ai/useCollaborator.ts`, `src/features/voice/transport.ts`, `src/features/voice/useVoiceSession.ts`
- Test: `tests/ai-server-client.test.ts` (one new case), `tests/voice-collaborator.test.ts` (one new case)

**Interfaces:**
- Consumes: `keyHeaders`, `readProviderKeys`, `hasVoiceKeys`, `useProviderKeys` from Task 3.
- Behavior: `/api/ai` requests carry `keyHeaders(useProviderKeys.getState().keys)`. `/api/voice/*` requests carry the same. `useVoiceSession.start()` sets `error` to `"Add your ElevenLabs API key and voice ID in Settings to use voice."` and returns when `hasVoiceKeys` is false.

- [ ] **Step 1: Write the failing client test**

In `tests/ai-server-client.test.ts`, find how `createCollaborator({ request })` is built (the `providerCall` helper returns `request`). Add near the other collaborator tests:

```ts
  it("sends the stored Gemini key as a header on every AI request", async () => {
    const { useProviderKeys } = await import("../src/features/settings/providerKeys");
    useProviderKeys.setState({ keys: { gemini: "visitor-key", elevenLabsKey: "", elevenLabsVoiceId: "" } });
    const provider = providerCall("read_code", {});
    const headers: string[] = [];
    const collaborator = createCollaborator({
      request: async (input, init) => {
        headers.push(new Headers(init?.headers).get("X-Gemini-Key") ?? "");
        return provider.request(input, init);
      },
      runCode: async () => ({}) as Run,
      onPending: () => {},
      onError: () => {},
    });
    await collaborator.ask("Read my code");
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((value) => value === "visitor-key")).toBe(true);
    useProviderKeys.setState({ keys: { gemini: "", elevenLabsKey: "", elevenLabsVoiceId: "" } });
  });
```
Adjust `providerCall("read_code", {})` to whatever tool/args shape the file's helper expects (look at an existing `providerCall(...)` usage and copy it).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ai-server-client.test.ts -t "stored Gemini key"`
Expected: FAIL, header empty.

- [ ] **Step 3: Attach headers in `src/features/ai/useCollaborator.ts`**

Add import:
```ts
import { keyHeaders, useProviderKeys } from "../settings/providerKeys";
```
In `modelRound`, change the `/api/ai` request headers:
```ts
    const response = await request("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...keyHeaders(useProviderKeys.getState().keys),
      },
```
Also update the 503 fallback message in the same function from `"Gemini is unavailable. Check the server configuration and try again."` to `"Gemini is unavailable. Check your API key in Settings and try again."`.

- [ ] **Step 4: Attach headers in `src/features/voice/transport.ts`**

Add import:
```ts
import { keyHeaders, useProviderKeys } from "../settings/providerKeys";
```
In `fetchScribeToken`:
```ts
  const response = await fetch("/api/voice/session", {
    method: "POST",
    headers: keyHeaders(useProviderKeys.getState().keys),
    signal,
  });
```
In `speak` (the `/api/voice/speech` fetch):
```ts
      headers: {
        "content-type": "application/json",
        ...keyHeaders(useProviderKeys.getState().keys),
      },
```

- [ ] **Step 5: Guard `start()` in `src/features/voice/useVoiceSession.ts`**

Add import:
```ts
import { hasVoiceKeys, useProviderKeys } from "../settings/providerKeys";
```
At the top of `async function start()` after `if (session.current) return;` add:
```ts
    if (!hasVoiceKeys(useProviderKeys.getState().keys)) {
      setError("Add your ElevenLabs API key and voice ID in Settings to use voice.");
      return;
    }
```

- [ ] **Step 6: Add a voice guard test**

In `tests/voice-collaborator.test.ts`, look at how the file renders or drives `useVoiceSession` (it likely uses `renderHook` or a wrapper). Add:

```ts
  it("refuses to start without ElevenLabs settings", async () => {
    const { useProviderKeys } = await import("../src/features/settings/providerKeys");
    useProviderKeys.setState({ keys: { gemini: "g", elevenLabsKey: "", elevenLabsVoiceId: "" } });
    // Use the same harness the neighbouring tests use to obtain a session.
    const session = await mountSession();
    await session.start();
    expect(session.status).toBe("off");
    expect(session.error).toBe("Add your ElevenLabs API key and voice ID in Settings to use voice.");
  });
```
Replace `mountSession()` with the file's actual helper. If the file only tests `progression`/`presentation` and has no hook harness, put this test in a new `tests/voice-session-keys.test.ts` using `@testing-library/react`'s `renderHook` if it is installed (`grep testing-library package.json`); otherwise skip the unit test and rely on the e2e in Task 7.

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run tests/ai-server-client.test.ts tests/voice-collaborator.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/ai/useCollaborator.ts src/features/voice tests
git commit -m "Send visitor provider keys with AI and voice requests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Settings dialog, header button, and degraded chat and voice states

**Files:**
- Create: `src/features/settings/SettingsDialog.tsx`, `src/features/settings/SettingsDialog.module.css`, `tests/e2e/provider-keys.spec.ts`
- Modify: `src/features/workspace/WorkspaceShell.tsx`, `src/features/ai/ChatPanel.tsx`, `src/features/voice/VoiceControls.tsx`, `playwright.config.ts`

**Interfaces:**
- Consumes: `useProviderKeys`, `hasVoiceKeys` from Task 3.
- Produces: header button `aria-label="Settings"`; dialog `aria-labelledby` title "Settings"; inputs labelled `Gemini API key`, `ElevenLabs API key`, `ElevenLabs voice ID`; buttons `Save keys`, `Clear keys`, `Close settings`. Chat setup card has `data-testid="chat-setup"` and a button `Open settings`.

- [ ] **Step 1: Seed keys for existing e2e tests**

Every existing AI/voice e2e spec mocks `/api/ai` or the ElevenLabs socket and expects the composer and microphone to exist. Seed keys for all tests in `playwright.config.ts` by adding to `use`:

```ts
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:3000",
          localStorage: [
            {
              name: "ideate:provider-keys:v1",
              value: JSON.stringify({ version: 1, gemini: "e2e-gemini", elevenLabsKey: "e2e-eleven", elevenLabsVoiceId: "e2e-voice" }),
            },
          ],
        },
      ],
    },
```

- [ ] **Step 2: Write the failing e2e test**

Create `tests/e2e/provider-keys.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("chat asks for a key, settings enable chat, and voice appears only with ElevenLabs settings", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("ideate:provider-keys:v1"));
  await page.route("**/api/ai", async (route) => {
    const key = route.request().headers()["x-gemini-key"];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "text", text: `key=${key}` }) + "\n" + JSON.stringify({ type: "done" }) + "\n",
    });
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Toggle study partner" }).click();
  await expect(page.getByTestId("chat-setup")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask your study partner" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Gemini API key").fill("visitor-gemini");
  await dialog.getByRole("button", { name: "Save keys" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("chat-setup")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Ask your study partner" }).fill("hello");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("AI study partner")).toContainText("key=visitor-gemini");
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByLabel("ElevenLabs API key").fill("visitor-eleven");
  await dialog.getByLabel("ElevenLabs voice ID").fill("voice-1");
  await dialog.getByRole("button", { name: "Save keys" }).click();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on microphone", exact: true })).toBeVisible();
  const exported = await page.evaluate(() => JSON.stringify(localStorage.getItem("ideate-workspace-v1") ?? ""));
  expect(exported).not.toContain("visitor-gemini");
});
```
Check the exact ndjson event shapes the client expects by reading how `tests/e2e/partner-defaults.spec.ts` or `tests/e2e/ai-review.spec.ts` fulfil `/api/ai`, and copy that body format instead of the one above if it differs.

- [ ] **Step 3: Run to verify failure**

Run: `npx playwright test tests/e2e/provider-keys.spec.ts`
Expected: FAIL, no `chat-setup` element.

- [ ] **Step 4: Create `src/features/settings/SettingsDialog.module.css`**

```css
.dialog {
  width: min(470px, calc(100vw - 32px));
  max-height: calc(100dvh - 40px);
  overflow: auto;
  padding: 24px;
  border: 1px solid #c7cebf;
  border-radius: 12px;
  color: #26382f;
  background: #fafaf7;
  box-shadow: 0 18px 70px #152a2633;
}
.dialog::backdrop {
  background: #152a265e;
}
.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.heading h2 {
  margin: 0;
  font: 23px Georgia, serif;
}
.dialog p,
.dialog small {
  font-size: 13px;
  line-height: 1.65;
  color: #63705e;
}
.field {
  display: grid;
  gap: 4px;
  margin-top: 14px;
  font-size: 13px;
}
.field input {
  padding: 8px 10px;
  border: 1px solid #c7cebf;
  border-radius: 6px;
  font: 13px ui-monospace, monospace;
  background: #fff;
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}
.warning {
  color: #824d34;
}
```

- [ ] **Step 5: Create `src/features/settings/SettingsDialog.tsx`**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useProviderKeys, type ProviderKeys } from "./providerKeys";
import styles from "./SettingsDialog.module.css";

export default function SettingsDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = useProviderKeys((s) => s.settingsOpen);
  const keys = useProviderKeys((s) => s.keys);
  const warning = useProviderKeys((s) => s.storageWarning);
  const [draft, setDraft] = useState<ProviderKeys>(keys);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setDraft(useProviderKeys.getState().keys);
      element.showModal();
    } else if (!open && element.open) element.close();
  }, [open]);

  const close = () => useProviderKeys.getState().closeSettings();
  const field = (key: keyof ProviderKeys) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft({ ...draft, [key]: event.target.value.trim() }),
  });

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="settings-title"
      onClose={close}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          useProviderKeys.getState().save(draft);
          close();
        }}
      >
        <div className={styles.heading}>
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <p>
          Keys stay in this browser and are only sent to this site&apos;s own API,
          which forwards them to the provider. Nothing is stored on the server.
        </p>
        <label className={styles.field}>
          Gemini API key
          <input type="password" autoComplete="off" spellCheck={false} {...field("gemini")} />
          <small>
            Required for the study partner. Create one at{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>
            .
          </small>
        </label>
        <label className={styles.field}>
          ElevenLabs API key
          <input type="password" autoComplete="off" spellCheck={false} {...field("elevenLabsKey")} />
        </label>
        <label className={styles.field}>
          ElevenLabs voice ID
          <input type="text" autoComplete="off" spellCheck={false} {...field("elevenLabsVoiceId")} />
          <small>Optional. Voice stays off until both ElevenLabs fields are set; chat works as text.</small>
        </label>
        {warning && <p className={styles.warning} role="alert">{warning}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              useProviderKeys.getState().clear();
              setDraft({ gemini: "", elevenLabsKey: "", elevenLabsVoiceId: "" });
            }}
          >
            Clear keys
          </button>
          <button type="submit" className="button primary">
            Save keys
          </button>
        </div>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 6: Mount the dialog and header button in `src/features/workspace/WorkspaceShell.tsx`**

Add imports:
```tsx
import { Settings } from "lucide-react";
import SettingsDialog from "../settings/SettingsDialog";
import { useProviderKeys } from "../settings/providerKeys";
```
(Merge `Settings` into the existing lucide import line.)

In the mount `useEffect` that calls `hydrateWorkspace()`, add as the first line:
```tsx
    useProviderKeys.getState().hydrate();
```
In the header `header-actions` div, insert directly before `<VoiceControls ...>`:
```tsx
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => useProviderKeys.getState().openSettings()}
          >
            <Settings size={17} />
          </button>
```
Directly after the closing `</header>` add `<SettingsDialog />`.

- [ ] **Step 7: Chat setup card in `src/features/ai/ChatPanel.tsx`**

Add import:
```tsx
import { useProviderKeys } from "../settings/providerKeys";
```
Inside the component, after the `useWorkspace()` destructure, add:
```tsx
  const geminiReady = useProviderKeys((s) => Boolean(s.keys.gemini));
```
Wrap the composer: replace `<form className="chat-composer" ...>...</form>` with a conditional. Keep the form exactly as is inside the `: (` branch:

```tsx
      {!geminiReady ? (
        <div className="chat-composer chat-setup" data-testid="chat-setup" role="status">
          <p>Add your own Gemini API key to chat. It stays in this browser.</p>
          <button
            type="button"
            className="button primary"
            onClick={() => useProviderKeys.getState().openSettings()}
          >
            Open settings
          </button>
        </div>
      ) : (
        <form className="chat-composer" ...existing form unchanged... </form>
      )}
```
Also make the starter-question buttons do nothing without a key: change their `onClick` to `onClick={() => geminiReady ? void collaborator.ask(text) : useProviderKeys.getState().openSettings()}`.

Add to `src/app/globals.css` after the `.chat-composer` rules:
```css
.chat-setup {
  display: grid;
  gap: 10px;
  justify-items: start;
}
.chat-setup p {
  margin: 0;
  font-size: 13px;
  color: #63705e;
}
```

- [ ] **Step 8: Hide the microphone in `src/features/voice/VoiceControls.tsx`**

Add import:
```tsx
import { hasVoiceKeys, useProviderKeys } from "../settings/providerKeys";
```
Inside the component add:
```tsx
  const voiceReady = useProviderKeys((s) => hasVoiceKeys(s.keys));
```
Wrap the microphone `<button ...>` in `{voiceReady && ( ... )}`. Wrap the `<span id={statusId} ...>` and the `voice.transcript` span in the same `{voiceReady && (<> ... </>)}`. Keep `{children}`, the Stop button, and the error paragraph unconditional. Change the Stop button's `disabled` to `disabled || (!connected && !working && !writing)` (unchanged) so it still stops AI writing without voice.

- [ ] **Step 9: Run to verify pass**

Run: `npm run typecheck && npx playwright test tests/e2e/provider-keys.spec.ts tests/e2e/partner-defaults.spec.ts tests/e2e/voice.spec.ts`
Expected: PASS. If the voice spec fails because it expects the status text before keys hydrate, the `storageState` seeding in Step 1 makes keys present at load; check `useProviderKeys.hydrate()` runs before the first paint (it is in the mount effect, which runs before `hydrated` becomes true).

- [ ] **Step 10: Commit**

```bash
git add -A src tests playwright.config.ts
git commit -m "Add settings dialog for visitor-provided API keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Layout presets applied through the editor dock

**Files:**
- Create: `src/features/workspace/presets.ts`, `tests/presets.test.ts`
- Modify: `src/features/workspace/editorDock.ts`, `src/features/workspace/DockedEditors.tsx`, `src/features/workspace/WorkspaceLayout.tsx`, `src/features/workspace/store.ts`

**Interfaces:**
- Produces:
```ts
// presets.ts
export type PresetId = "code" | "notes" | "code-notes" | "everything";
export type LayoutPreset = { id: PresetId; label: string; start: Tool; opens: OpenEditor[] };
export const presets: Record<PresetId, LayoutPreset>;
export const presetIds: PresetId[];
export const isPresetId: (value: unknown) => value is PresetId;
export const PRESET_STORAGE_KEY = "ideate:layout-preset:v1";
export function readPresetId(): PresetId;         // default "code"
export function savePresetId(id: PresetId): boolean;
// editorDock.ts
initialize(layout: SerializedDockview | null, tool: EditorPanel, opens?: OpenEditor[]): void
// DockedEditors props: `opens?: OpenEditor[]` replaces `start?: OpenEditor`
// store.ts
navigate(view: View, options?: { reveal?: boolean; preset?: PresetId }): void
navigationPreset: PresetId | null
```

- [ ] **Step 1: Write the failing unit test**

Create `tests/presets.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESET_STORAGE_KEY,
  isPresetId,
  presetIds,
  presets,
  readPresetId,
  savePresetId,
} from "../src/features/workspace/presets";

// Node test environment: stub storage like tests/partner-defaults.test.ts.
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("layout presets", () => {

  it("declares four presets whose open commands only reference panels already on screen", () => {
    expect(presetIds).toEqual(["code", "notes", "code-notes", "everything"]);
    for (const id of presetIds) {
      const preset = presets[id];
      const onScreen = new Set<string>([preset.start]);
      for (const open of preset.opens) {
        expect(onScreen.has(open.reference), `${id}: ${open.tool} references ${open.reference}`).toBe(true);
        expect(onScreen.has(open.tool)).toBe(false);
        onScreen.add(open.tool);
      }
    }
    expect(presets.code.opens).toEqual([]);
    expect(presets.notes.start).toBe("notes");
    expect(presets["code-notes"].opens.map((o) => o.tool)).toEqual(["notes"]);
    expect(presets.everything.opens.map((o) => o.tool).sort()).toEqual(["board", "notes", "spreadsheet"]);
  });

  it("remembers the last preset and defaults to code", () => {
    expect(readPresetId()).toBe("code");
    expect(savePresetId("everything")).toBe(true);
    expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBe("everything");
    expect(readPresetId()).toBe("everything");
    localStorage.setItem(PRESET_STORAGE_KEY, "bogus");
    expect(readPresetId()).toBe("code");
    expect(isPresetId("notes")).toBe(true);
    expect(isPresetId("desk")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/presets.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/features/workspace/presets.ts`**

```ts
import type { OpenEditor } from "./editorDock";
import type { Tool } from "./model";

export type PresetId = "code" | "notes" | "code-notes" | "everything";
export type LayoutPreset = {
  id: PresetId;
  label: string;
  start: Tool;
  opens: OpenEditor[];
};

/** Presets are open commands, not serialized dockview, so they cannot drift. */
export const presets: Record<PresetId, LayoutPreset> = {
  code: { id: "code", label: "Code", start: "code", opens: [] },
  notes: { id: "notes", label: "Notes", start: "notes", opens: [] },
  "code-notes": {
    id: "code-notes",
    label: "Code + Notes",
    start: "code",
    opens: [{ tool: "notes", placement: "right", reference: "code" }],
  },
  everything: {
    id: "everything",
    label: "Everything",
    start: "code",
    opens: [
      { tool: "notes", placement: "right", reference: "code" },
      { tool: "board", placement: "below", reference: "code" },
      { tool: "spreadsheet", placement: "below", reference: "notes" },
    ],
  },
};
export const presetIds: PresetId[] = ["code", "notes", "code-notes", "everything"];
export const isPresetId = (value: unknown): value is PresetId =>
  presetIds.includes(value as PresetId);
export const PRESET_STORAGE_KEY = "ideate:layout-preset:v1";

export function readPresetId(): PresetId {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    return isPresetId(raw) ? raw : "code";
  } catch {
    return "code";
  }
}

export function savePresetId(id: PresetId): boolean {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Let `EditorDock.initialize` accept a list of opens (`src/features/workspace/editorDock.ts`)**

Replace the `initialize` method:

```ts
  initialize(
    layout: SerializedDockview | null,
    tool: EditorPanel,
    opens: OpenEditor[] = [],
  ) {
    this.transaction(() => {
      let restored = false;
      if (layout) {
        try {
          this.api.fromJSON(layout);
          restored = this.api.panels.length > 0;
        } catch {
          this.api.clear();
        }
      }
      if (!this.api.panels.length) this.add(tool);
      for (const open of opens) this.open(open);
      if (opens.length || !restored) this.focus(tool);
    });
  }
```

- [ ] **Step 6: Update `src/features/workspace/DockedEditors.tsx`**

Change the prop `start?: OpenEditor;` to `opens?: OpenEditor[];` and the `onReady` call to:
```tsx
          instance.initialize(
            current.current.initialLayout,
            current.current.initialTool,
            current.current.opens,
          );
```

- [ ] **Step 7: Add the preset to navigation in `src/features/workspace/store.ts`**

Add import `import type { PresetId } from "./presets";`. In the `Store` type add `navigationPreset: PresetId | null;` and change `navigate`'s signature to `navigate: (view: View, options?: { reveal?: boolean; preset?: PresetId }) => void;`. In the initial state add `navigationPreset: null,`. In `navigate` add `navigationPreset: options?.preset ?? null,` to the `set({...})` object.

- [ ] **Step 8: Apply presets in `src/features/workspace/WorkspaceLayout.tsx`**

1. Import `presets` and `readPresetId`, `savePresetId`, `isPresetId`, type `PresetId`:
```ts
import { presets, readPresetId, savePresetId, type PresetId } from "./presets";
```
2. Read the store field: after `const navigationReveal = ...` add `const navigationPreset = useWorkspace((s) => s.navigationPreset);`.
   `WorkspaceLayout` is a dynamic import that mounts only after `hydrated` is true, so on first load the entry navigation (Task 9) has already bumped `navigationEpoch` before this component exists. Make the handled-epoch ref start behind when a preset is pending so the effect below runs once on mount: change `const handledNavigation = useRef(navigationEpoch);` to
```ts
  const handledNavigation = useRef(navigationPreset ? navigationEpoch - 1 : navigationEpoch);
```
3. Replace `const [start, setStart] = useState<OpenEditor | undefined>();` with `const [opens, setOpens] = useState<OpenEditor[] | undefined>();`. Replace every `setStart(undefined)` with `setOpens(undefined)` and `setStart(command)` with `setOpens([command])`. Pass `opens={opens}` instead of `start={start}` to `<DockedEditors>`.
4. In the navigation `useLayoutEffect`, after the existing reset lines (`setEnabled(false); setDockState(null); setOpens(undefined); persist();`) append:
```ts
    if (navigationPreset) {
      const preset = presets[navigationPreset];
      initialLayout.current = null;
      initialFocus.current = null;
      if (preset.opens.length) {
        setOpens(preset.opens);
        setEnabled(true);
      }
      savePresetId(navigationPreset);
    }
```
Add `navigationPreset` to that effect's dependency array.
5. Add a preset picker. Add a `currentPreset` state: `const [currentPreset, setCurrentPreset] = useState<PresetId>(readPresetId);` and update it inside the block above with `setCurrentPreset(navigationPreset);`. Pass to `LayoutControls`: `preset={currentPreset}` and `applyPreset={(id) => useWorkspace.getState().navigate(presets[id].start, { preset: id })}`.

- [ ] **Step 9: Render the picker in `src/features/workspace/LayoutControls.tsx`**

Add to `Props`:
```ts
  preset: PresetId;
  applyPreset: (id: PresetId) => void;
```
Import `presetIds, presets, type PresetId` from `./presets`. As the first child of `<div className={styles.controls}>` render:
```tsx
      <select
        className={styles.presetPicker}
        aria-label="Layout preset"
        title="Layout preset"
        value={props.preset}
        onChange={(event) => props.applyPreset(event.target.value as PresetId)}
      >
        {presetIds.map((id) => (
          <option key={id} value={id}>{presets[id].label}</option>
        ))}
      </select>
```
Add to `src/features/workspace/WorkspaceLayout.module.css`:
```css
.presetPicker {
  padding: 5px 8px;
  border: 1px solid #c7cebf;
  border-radius: 6px;
  background: #fff;
  font: 12px system-ui, sans-serif;
  color: #26382f;
}
```

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npx vitest run tests/presets.test.ts tests/editor-layout.test.ts`
Expected: PASS. Then run `npx playwright test tests/e2e/editor-layout.spec.ts tests/e2e/desk-navigation.spec.ts` and expect PASS (the desk is still the default at this point; Task 9 changes that).

- [ ] **Step 11: Commit**

```bash
git add -A src tests
git commit -m "Add named layout presets applied through the editor dock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Workspace-first entry

**Files:**
- Modify: `src/features/workspace/store.ts`, `src/features/workspace/WorkspaceShell.tsx`, `tests/e2e/desk-navigation.ts`, `tests/e2e/desk-navigation.spec.ts`
- Create: `tests/e2e/entry.spec.ts`

**Interfaces:**
- Consumes: `readPresetId`, `presets`, `PresetId` from Task 8.
- Produces: `hydrateWorkspace(entry?: { view: View; preset?: PresetId })` sets `view`, `page`, `visited`, `navigationEpoch`, and `navigationPreset` in the same state update that flips `hydrated`. Brand link `aria-label="Ideate, desk"`, visible caption `Desk` when not on the desk. `?view=desk` opens the desk.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/entry.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });
const python = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Python workspace", exact: true });
const journal = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Study journal", exact: true });

test("a first visit opens the Code preset, presets are remembered, and the desk is optional", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(python(page)).toBeVisible();
  await expect(page.locator(".desk-home")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Layout preset" })).toHaveValue("code");

  await page.getByRole("combobox", { name: "Layout preset" }).selectOption("code-notes");
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(python(page)).toBeVisible();
  await expect(journal(page)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Layout preset" })).toHaveValue("code-notes");

  await page.getByRole("link", { name: "Ideate, desk" }).click();
  await expect(page.locator(".desk-home")).toBeVisible();

  await page.goto("/?view=desk");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(page.locator(".desk-home")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/e2e/entry.spec.ts`
Expected: FAIL, the desk is shown on first visit.

- [ ] **Step 3: Accept an entry view in `hydrateWorkspace` (`src/features/workspace/store.ts`)**

Change the signature and the success `setState`:

```ts
export type HydrateEntry = { view: View; preset?: PresetId };

export async function hydrateWorkspace(entry?: HydrateEntry) {
  if (started) return;
  started = true;
  const entryState = entry
    ? {
        view: entry.view,
        page: entry.view,
        visited: entry.view === "desk" ? [] : [entry.view as Tool],
        navigationEpoch: useWorkspace.getState().navigationEpoch + 1,
        navigationPreset: entry.preset ?? null,
      }
    : {};
  // ...existing auto-apply block unchanged...
  try {
    const data = await loadWorkspace();
    useWorkspace.setState({
      ...(data ? { data } : {}),
      ...entryState,
      hydrated: true,
      saveStatus: "saved",
    });
    savedData = useWorkspace.getState().data;
  } catch {
    useWorkspace.setState({
      ...entryState,
      hydrated: true,
      recoveryNeeded: true,
      // ...rest unchanged
```
Also in `clearData`, replace the `view: "desk" as const, page: "desk" as const,` pair with:
```ts
            view: "code" as const,
            page: "code" as const,
            visited: ["code" as const],
            navigationPreset: "code" as const,
            navigationEpoch: current.navigationEpoch + 1,
```
(The epoch bump is what makes `WorkspaceLayout`'s navigation effect apply the preset.)

- [ ] **Step 4: Compute the entry in `src/features/workspace/WorkspaceShell.tsx`**

Import `presets, readPresetId` from `./presets`. Replace `void hydrateWorkspace();` with:

```tsx
    const wantsDesk = new URLSearchParams(window.location.search).get("view") === "desk";
    const presetId = readPresetId();
    void hydrateWorkspace(
      wantsDesk ? { view: "desk" } : { view: presets[presetId].start, preset: presetId },
    );
```
Rename the brand link: `aria-label="Ideate, desk"`, `title={view === "desk" ? "Ideate" : "Desk"}`, and the caption `<small className="brand-back">Desk</small>`.

- [ ] **Step 5: Update the e2e desk helper `tests/e2e/desk-navigation.ts`**

Change the first line of `goToTool` to click the renamed link:
```ts
  await page.getByRole("link", { name: "Ideate, desk" }).click();
```
In `tests/e2e/desk-navigation.spec.ts` update any `"Ideate, back to desk"` strings the same way, and in the test `Escape stays in the editor and simple desk preference survives reload`, if it asserts the desk is visible right after `page.goto("/")`, insert `await goToTool(page, "Desk");` before that assertion.

Run `grep -rn "back to desk\|Back to desk" tests src` and update every remaining occurrence to the new label.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run tests/partner-defaults.test.ts tests/storage-recovery.test.ts tests/workspace-clear.test.ts`
Expected: PASS (`hydrateWorkspace()` with no argument still works).

Run: `npx playwright test tests/e2e/entry.spec.ts tests/e2e/desk-navigation.spec.ts tests/e2e/workspace-controls.spec.ts`
Expected: PASS. If `workspace-controls.spec.ts` asserts the desk after "Clear all workspace data", change it to expect the Python region instead.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "Open straight into the remembered layout preset

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Environment, docs, and full verification

**Files:**
- Modify: `.env.example`, `README.md`, `docs/architecture.md`, `docs/ai-collaboration.md`, `docs/README.md`

- [ ] **Step 1: Rewrite `.env.example`**

```
# No provider secrets belong here. Visitors add their own Gemini and ElevenLabs
# keys in the app's Settings dialog; they stay in the browser.
GEMINI_MODEL=gemini-3.8-flash
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
NEXT_PUBLIC_RUNNER_ORIGIN=http://localhost:3001
```

- [ ] **Step 2: Update `README.md`**

- Replace the paragraph starting `Copy \`.env.example\` to \`.env.local\` and set \`GEMINI_API_KEY\`.` with:
  `Copy \`.env.example\` to \`.env.local\`. No API keys go on the server. Open the app, click **Settings** in the header, and paste your own Gemini API key. It is stored in your browser and sent only to this site's own API, which forwards it to Google.`
- Replace the paragraph starting `For voice, also set \`ELEVENLABS_API_KEY\`` first sentence with: `For voice, also add your ElevenLabs API key and voice ID in **Settings**. Without them the microphone is hidden and the partner works as text chat.` Keep the remaining sentences.
- Replace `Use the logo's **Back to desk** link to choose a tool.` with `The site opens in the last layout preset you used (**Code**, **Notes**, **Code + Notes**, or **Everything**; the header picker switches between them). The logo's **Desk** link opens the optional 3D desk, and \`/?view=desk\` links straight to it.`
- Add a `## Deploying` section before `## Try the study loop`:
  ```
  ## Deploying

  The Next.js app needs no secrets. Set `NEXT_PUBLIC_RUNNER_ORIGIN` to wherever the Python runner is reachable. Each visitor supplies their own Gemini (and optional ElevenLabs) key through Settings; keys never reach the server's storage or logs. Workspaces stay in each visitor's browser.
  ```
- Replace `Nothing has been deployed.` at the end with `The app is prepared for public deployment with visitor-supplied keys.`
- Replace `The Gemini check makes small live API requests and requires the local key.` with `The Gemini check makes small live API requests and reads \`GEMINI_API_KEY\` from \`.env.local\` for that script only.`

- [ ] **Step 3: Update docs**

`docs/architecture.md` line ~60: replace `The server owns \`GEMINI_API_KEY\` and the configurable \`GEMINI_MODEL\`; the default is \`gemini-3.8-flash\`. The key is neither a public environment variable nor part of workspace exports.` with `Each visitor supplies a Gemini key in Settings; the browser stores it and sends it as the \`X-Gemini-Key\` header to \`/api/ai\`, which forwards it to Google without logging or storing it. The server owns only \`GEMINI_MODEL\` (default \`gemini-3.8-flash\`). Keys are not part of workspace exports.`

`docs/ai-collaboration.md` line ~11: replace `\`GEMINI_API_KEY\` remains on the application server.` with `Each visitor supplies their own Gemini key through Settings; the server holds none.`

`docs/README.md` line ~24: replace `- Use a 3D desk to open readable, full-size 2D tools.` with `- Open straight into a layout preset; the 3D desk is an optional view.`

- [ ] **Step 4: Full verification**

Run each and record the result:

```bash
npm run typecheck
npx vitest run
npx playwright test
```
Expected: typecheck clean; all unit tests pass; all e2e pass. Fix any e2e that still navigates by the old label or expects the desk on load, following the patterns in Task 9 Step 5.

Run `grep -rn "GEMINI_API_KEY\|ELEVENLABS_API_KEY\|ELEVENLABS_VOICE_ID\|NESSIE\|import_bank_data\|SAMPLE_CODE\|sampleBoard" src tests .env.example` and confirm the only hit is `scripts/check-gemini.mjs` (not in the grep set) and none in `src`.

- [ ] **Step 5: Commit**

```bash
git add -A .env.example README.md docs
git commit -m "Document visitor-supplied keys and the workspace-first entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
