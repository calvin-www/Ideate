# Ideate

A 3D study desk for making algorithms click. Draw an idea on the whiteboard, test it in Python, and keep what you learn in a Markdown journal. A shared Gemini study partner can explain selections and propose changes across the workspace.

## Run locally

Use Node 22.12+ or a current supported Node release, and Chrome for browser tests.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. Keep it server-side; do not add a `NEXT_PUBLIC_` prefix. The current development workspace already has a local key configured.

AI output defaults to 16,384 tokens per generation and 32,768 per request across tool rounds and retries, including thinking. Configure these with `AI_MAX_OUTPUT_TOKENS` and `AI_MAX_JOB_OUTPUT_TOKENS`. Cutoffs can recover automatically up to twice within the remaining budget; **Continue** grants a new bounded budget when the response pauses. Completed edits and partial text are preserved.

```sh
npm run dev
```

Open **http://localhost:3000**. The same command starts the separate Python runner at `http://localhost:3001`. Both listen on loopback. Use the same app hostname consistently because browser saves belong to that origin.

For an optimized local run:

```sh
npm run build
npm start
```

The Python runtime ships with the npm dependency and runs in a separate-origin iframe and Web Worker. It supports standard-library study examples, printed output, errors, Run and Stop. **Debug** pauses before each Python line, highlights it, and shows local variables. **Step** enters your functions; **Continue** finishes the captured program. Debugging needs a browser with [WebAssembly JSPI support](https://blog.pyodide.org/posts/jspi/) and is tested in Chrome. It has no shell, package installer, or interactive input. Each run starts clean, with a ten-second execution budget and 64 KiB output limit. Time spent inspecting a responsive paused debugger does not consume the budget.

## Try the study loop

1. Open the whiteboard and choose **Load binary search example**. **Fit drawing** brings the whole diagram into view.
2. Select part of the diagram and ask the study partner for a hint or explanation.
3. Choose **Show Python**, review the proposed change, then **Apply & run**. The prepared Python example also runs without AI.
4. Change `target = 16` to `target = 17` and compare the actual traces.
5. Select output and ask to add the lesson to your notes. Apply the Markdown diff, then open its saved source links.

AI edits wait for review by default. Turn on **Auto-apply changes** in chat to apply new validated proposals automatically; the preference is remembered in this browser. Existing pending proposals still wait for review. Both modes preserve revision checks and undo, and running Python still requires an explicit request. Later manual changes invalidate stale proposals. Ordinary undo restores the prior content; conflicting undo shows an explicit restore preview and keeps the replaced version recoverable.

Chat and journal previews render LaTeX equations with `$...$`, display `$$` blocks, `\(...\)`, and `\[...\]`. The study partner is instructed to lead with the useful idea, explain terms in plain language, and use short paragraphs and concrete examples.

**Clear chat** removes the conversation and stops its active response while keeping your documents and saved changes. The header's **Clear workspace data** button offers separate clears for whiteboard, Python, and notes, plus **Clear all workspace data**. Each clear asks for confirmation and offers an export first. A full clear removes documents and history, switches off auto-apply, and gives the desk a little table flip; reduced-motion settings show a static confirmation.

Work is saved in IndexedDB in this browser. Export a JSON workspace for a portable backup. Python and Markdown also have individual downloads. No account or cloud sync is required.

The header's Whiteboard, Computer, and Journal buttons always open one full-size editor. Use **Layout** to split beside or below another editor, combine editors into tabs, or float an editor above the workspace. Drag tab headers to rearrange editors, drag floating title bars to move them, and resize at dividers or window edges. Group controls let you dock, maximize, or hide an editor. **Restore layout** (or Escape while maximized) returns to the prior arrangement. **Single editor** keeps your arrangement available under **Restore saved layout**; **Reset layout** removes that preference. Arrangements are stored separately from documents in this browser. Editor undo history and running Python survive layout changes. Narrow windows use one editor while retaining the desktop arrangement. Separate browser popout windows are not included.

The whiteboard accepts PNG, JPEG, and WebP files by drag-and-drop, screenshot paste, or the image tool. Images remain editable and are included in local saves, workspace exports, and board previews. Each image can be up to 5 MB, with a 10 MB budget for encoded image data per board. Image files are retained for undo until you clear the whiteboard. For images from websites, download the file first and then drop it onto the board.

Shortcuts: **Alt+1/2/3** switches to board/code/notes, **Ctrl/Cmd+Enter** runs Python, **Ctrl/Cmd+S** flushes the local save. **Escape** returns to the desk outside the whiteboard's own controls, closes source dialogs, or leaves the chat composer. All tools have visible navigation controls. Small screens and WebGL failure use object cards; **Use simple view** is available on the desk.

## Verify

```sh
npm run typecheck
npm test
npm run test:e2e
npm run check:gemini
```

The Gemini check makes small live API requests and requires the local key. Other tests use fixtures for AI and actual Pyodide/Excalidraw where relevant. Browser tests use installed Chrome; runner tests can use installed Chromium instead. The production build and browser checks are separate from the live model availability check.

[Documentation](docs/README.md) covers product decisions, architecture, interaction design, and the original hackathon plan. [Implementation status](docs/implementation-status.md) records validation and remaining limits.

Current verification: **133 unit/integration tests and 19 browser tests pass**, along with typecheck and the production build. A [prepared example](docs/examples/README.md) is available for Gemini outages or rate limits; its saved output is explicitly historical.

This is a fresh implementation; the earlier Ideate repository was used as design reference. Nothing has been deployed.
