# Ideate

A 3D study desk for making algorithms click. Draw an idea on the whiteboard, test it in Python, and keep what you learn in a Markdown journal. A shared Gemini study partner can explain selections and propose changes across the workspace.

## Run locally

Use Node 22.12+ or a current supported Node release, and Chrome for browser tests.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. Keep it server-side; do not add a `NEXT_PUBLIC_` prefix. The current development workspace already has a local key configured.

```sh
npm run dev
```

Open **http://localhost:3000**. The same command starts the separate Python runner at `http://localhost:3001`. Both listen on loopback. Use the same app hostname consistently because browser saves belong to that origin.

For an optimized local run:

```sh
npm run build
npm start
```

The Python runtime ships with the npm dependency and runs in a separate-origin iframe and Web Worker. It supports standard-library study examples, printed output, errors, Run and Stop. It has no shell, package installer, or interactive input. Each run starts clean, with a ten-second execution limit and 64 KiB output limit.

## Try the study loop

1. Open the whiteboard and choose **Load binary search example**. **Fit drawing** brings the whole diagram into view.
2. Select part of the diagram and ask the study partner for a hint or explanation.
3. Choose **Show Python**, review the proposed change, then **Apply & run**. The prepared Python example also runs without AI.
4. Change `target = 16` to `target = 17` and compare the actual traces.
5. Select output and ask to add the lesson to your notes. Apply the Markdown diff, then open its saved source links.

AI edits always wait for review. Later manual changes invalidate stale proposals. Ordinary undo restores the prior content; conflicting undo shows an explicit restore preview and keeps the replaced version recoverable.

Work is saved in IndexedDB in this browser. Export a JSON workspace for a portable backup. Python and Markdown also have individual downloads. No account or cloud sync is required.

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

This is a fresh implementation; the earlier Ideate repository was used as design reference. Nothing has been deployed.
