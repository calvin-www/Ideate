# Ideate

A 3D study desk for making algorithms click. Draw an idea on the whiteboard, test it in Python, and keep what you learn in a Markdown journal. A shared Gemini study partner can explain selections and propose changes across the workspace.

## Run locally

Use Node 22.12+ or a current supported Node release, and Chrome for browser tests.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. Keep it server-side; do not add a `NEXT_PUBLIC_` prefix. The current development workspace already has a local key configured.

AI output tokens are not capped by the app; the model's own output limit is the only ceiling. Cutoffs and invalid tool calls can recover automatically up to twice per request, and each request allows up to eight tool rounds; **Continue** grants fresh attempts when the response pauses. Completed edits and partial text are preserved.

```sh
npm run dev
```

Open **http://localhost:3000**. The command first copies the Python runner and Pyodide assets into `public/runner/` (ignored by Git), then starts the app; there is no second server. Use the same app hostname consistently because browser saves belong to that origin.

For voice, also set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env.local`, then restart the server. Click the header microphone button and allow microphone access. Gemini remains the study partner; ElevenLabs handles live transcription and speech. The partner speaks while whiteboard strokes or editor lines appear. The adjacent chat button opens the study partner panel; speaking does not open it automatically.

Voice follows the **Auto-apply changes** preference. With review enabled, say “apply it” or use **Apply** to start a proposed step. Speak to interrupt; the visible partial function or stroke stays where it paused, saved as an undoable change. Ask your question, then say “continue” to continue the unfinished task from that work. **Mute microphone** stops transcription while the current explanation can continue. **Stop** ends speech and drawing and turns off the microphone. Pan or zoom the board during an explanation to take camera control without interrupting it. This first version paces visuals by short spoken steps; exact word timing and microphone interruption sensitivity still need real-device tuning.

For an optimized local run:

```sh
npm run build
npm start
```

The Python runtime ships with the npm dependency and runs in an iframe and Web Worker served by the app itself, so a plain `next build` deployment (for example Vercel) includes it. It supports standard-library study examples, printed output, errors, Run and Stop. **Debug** pauses before each Python line, highlights it, and shows local variables. **Step** enters your functions; **Continue** finishes the captured program. Debugging needs a browser with [WebAssembly JSPI support](https://blog.pyodide.org/posts/jspi/) and is tested in Chrome. It has no shell, package installer, or interactive input. Each run starts clean, with a ten-second execution budget and 64 KiB output limit. Time spent inspecting a responsive paused debugger does not consume the budget.

## Try the study loop

1. Open the whiteboard and choose **Load binary search example**. **Fit drawing** brings the whole diagram into view.
2. Select part of the diagram and ask the study partner for a hint or explanation.
3. Ask the study partner to show the idea in Python, then run the code. With auto-apply disabled, review the proposed change and choose **Apply & run**. The prepared Python example also runs without AI.
4. Change `target = 16` to `target = 17` and compare the actual traces.
5. Select output and ask to add the lesson to your notes, then open its saved source links.

AI edits auto-apply by default. Turn off **Auto-apply changes** in chat to review new proposals; the preference is remembered in this browser. Existing pending proposals still wait for review. Both modes preserve revision checks and undo, and running Python still requires an explicit request. Later manual changes invalidate stale proposals. Ordinary undo restores the prior content; conflicting undo shows an explicit restore preview and keeps the replaced version recoverable.

Chat and journal previews render LaTeX equations with `$...$`, display `$$` blocks, `\(...\)`, and `\[...\]`. The study partner is instructed to lead with the useful idea, explain terms in plain language, and use short paragraphs and concrete examples.

**Clear chat** removes the conversation and stops its active response while keeping your documents and saved changes. The header's **Clear workspace data** button offers separate clears for whiteboard, Python, and notes, plus **Clear all workspace data**. Each clear asks for confirmation and offers an export first. A full clear removes documents and history, restores the auto-apply default, and gives the desk a little table flip; reduced-motion settings show a static confirmation.

Work is saved in IndexedDB in this browser. Export a JSON workspace for a portable backup. Python and Markdown also have individual downloads. No account or cloud sync is required.

Use the logo's **Back to desk** link to choose a tool. Whiteboard, Computer, and Journal always open alone from the desk, preserving their content and editor state. The header **tool dock** lists every tool as a chip. Click a chip to add that tool as a tab in the focused group, or drag it onto an editor edge to split beside or below it, onto the center to add a tab, and onto the dock itself to float it. Alt+Shift+1/2/3/4 adds a tool as a tab. Drag tab headers to rearrange editors, floating title bars to move them, and dividers or window edges to resize them. Group controls let you dock, maximize, or hide an editor. **Restore arrangement** (or Escape while maximized) exits maximization. The **Arrangement** menu holds **Show only [tool]**, which hides other panes, **Restore previous arrangement**, which explicitly recovers the most recent arrangement including after desk navigation or reload, and **Reset arrangement**, which forgets the saved layout. There is one shared arrangement, stored separately from documents in this browser. Editor undo history and running Python survive layout changes. Computer opens with output embedded. Narrow windows temporarily show one editor and move the chips into a **Tools** menu that switches between them, without overwriting the desktop arrangement; selecting a desk object still opens only that tool. Separate browser popout windows are not included.

Python's **Output** header also has a **Move output** control. Place output beside, above, or below the source, add it as a tab, or float it independently. Drag its tab to rearrange it with other workspace panels. **Return output to editor** restores the embedded output area. Output continues updating while detached, and its arrangement is included in saved layouts.

The whiteboard accepts PNG, JPEG, and WebP files by drag-and-drop, screenshot paste, or the image tool. Images remain editable and are included in local saves, workspace exports, and board previews. Each image can be up to 5 MB, with a 10 MB budget for encoded image data per board. Image files are retained for undo until you clear the whiteboard. For images from websites, download the file first and then drop it onto the board.

Shortcuts: **Alt+1/2/3** opens board/code/notes alone, just like selecting a desk object; **Ctrl/Cmd+Enter** runs Python and **Ctrl/Cmd+S** flushes the local save. **Escape** dismisses menus, exits maximization, closes source dialogs, or leaves the chat composer; it does not navigate to the desk. Study Partner references reveal the requested tool within the current arrangement. Small screens and WebGL failure use object cards; **Use simple view** is available on the desk and the preference survives reloads.

## Work through finances

Open **Spreadsheet** on the desk or press **Alt+4**. Write income and expenses in the journal or whiteboard, then ask the partner: **“Put these expenses into a monthly budget spreadsheet with formulas for totals and remaining income.”** The partner reads the source material and edits cells using your existing auto-apply or review preference. Accepted edits can be undone; later manual changes require a restore review.

The grid supports cell editing, a formula bar, Shift+arrow range selection, tab-separated paste, undo/redo, and General, Currency (USD), and Percent formats. Use `=SUM(B2:B8)` for a total or `=B1-B9` for remaining income. Supported formulas include arithmetic, parentheses, cell references, ranges inside `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, and `ROUND`. Formula errors appear in cells. Press F2 or double-click to move the cursor inside a cell. Copy/paste preserves formula references exactly; it does not shift them like Excel.

Spreadsheet content saves locally and travels with JSON workspace exports. **CSV** exports calculated values; JSON preserves formulas and formats. Older workspaces open with an empty spreadsheet. This version has one sheet, up to 200 rows and 26 columns, with 5,000 populated cells and a 200,000-character storage limit. It does not import Excel files or connect to real banks.

## Connect a mock bank

**Connect mock bank** in the Spreadsheet header pulls a demo customer's accounts and one month of transactions from Capital One's [Nessie](http://api.nessieisreal.com) sandbox: three accounts, a dated ledger with **Money in** and **Money out** columns, totals, and a by-category block. It is pretend money for one app-managed customer, not a real bank. You can also ask the partner: **"Pull in my bank transactions and tell me where my money goes."** The import replaces the sheet (with a confirmation when it has content) and is undoable.

Set `NESSIE_API_KEY` in `.env.local` to use the live sandbox; the first connect seeds the demo customer with about forty records and takes a few seconds, and later connects reuse it. Nessie stores purchase and deposit amounts as whole dollars and is known to go down during hackathons, so if the key is missing or the API fails, the same data is imported from a bundled snapshot and the sheet says **Offline demo data**. The partner is told which source was used.

## Verify

```sh
npm run typecheck
npm test
npm run test:e2e
npm run check:gemini
```

The Gemini check makes small live API requests and requires the local key. Other tests use fixtures for AI and actual Pyodide/Excalidraw where relevant. Browser tests use installed Chrome; runner tests can use installed Chromium instead and serve the built runner files with the same headers as the app. The production build and browser checks are separate from the live model availability check.

[Documentation](docs/README.md) covers product decisions, architecture, interaction design, and the original hackathon plan. [Implementation status](docs/implementation-status.md) records validation and remaining limits.

Automated coverage includes local persistence, review and auto-apply, editor layouts, Python execution, microphone controls, board navigation during AI drawing, and text highlighting. A [prepared example](docs/examples/README.md) is available for Gemini outages or rate limits; its saved output is explicitly historical.

This is a fresh implementation; the earlier Ideate repository was used as design reference. The app deploys as a single Next.js project; `npm run build` bundles the Python runner.
