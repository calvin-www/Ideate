# Desk and tool interaction design

## Experience model

Use a 3D overview for orientation and identity, then open full-size DOM editing interfaces. Users should not type into perspective-distorted surfaces in the scene.

The desk opens one tool at a time. Layout can arrange multiple tools in the same workspace; returning through a desk object always opens only the selected tool. AI jobs and Python runs belong to the workspace and may continue while the user changes views.

## Desk composition

Use a small, warm study space with simplified geometry: muted wood, cream paper, dark hardware, and pine-green accents for AI activity. The implementation uses primitive meshes. A whole explorable room is outside the MVP.

| Object     | Placement                         | Click target                        | Content preview                                              |
| ---------- | --------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| Whiteboard | Back-left, angled toward the user | The entire board surface            | Current board thumbnail; element count as the basic fallback |
| Computer   | Back-center                       | Monitor and keyboard both open Code | Filename, short code excerpt, and latest run status          |
| Journal    | Front-right, visibly open         | Either page                         | Current heading and a few lines of notes                     |

Use a fixed, slightly elevated perspective camera that shows all three objects at once. Do not require orbiting, walking, dragging the room, or precise mesh selection.

One soft key light, ambient fill, and inexpensive contact shadows are sufficient. Avoid reflections and expensive effects until the workflow is stable.

## Discoverability and transitions

- Keep text labels visible for Whiteboard, Computer, and Journal.
- Hover and keyboard focus add a clear outline. Touch opens directly and never depends on hover.
- Use generous hit targets; decorative geometry must not intercept object clicks.
- Show one initial instruction: "Choose an object to start."
- Use the logo with its **Back to desk** label as the return path; desk objects are the visible tool navigation.
- Opening an object uses a short camera move and crossfade, targeting about 250 ms, then shows the full-size tool.
- Alt+1/2/3 opens Whiteboard/Computer/Journal alone, matching the desk objects. Show these shortcuts on object labels.
- A visible **Back to desk** control returns to the overview without resetting content.
- Rapid navigation must settle on the most recent user choice; animation completion cannot reopen an older destination.

The scene should stop rendering while an opaque tool interface covers it. Return transitions must not delay the availability of navigation controls.

Layout offers beside/below placements first, with tabs and floating panes under **More arrangements**. **Show only [tool]** keeps the focused tool; **Restore previous arrangement** recovers the last arrangement explicitly. Selecting desk objects never automatically restores a saved layout. Content, editor history, cursor, scroll, journal mode, and board camera remain in the mounted editors. Output returns to its embedded location when Computer opens alone. Following an artifact reference reveals its tool without discarding an active arrangement.

## Whiteboard

Expose Excalidraw's standard pen, eraser/delete, text, rectangles, ellipses, diamonds, arrows, selection, multiselection, move/resize, duplicate, undo/redo, and pan/zoom behavior.

Labeled boxes represent array entries, arrows represent pointers or graph edges, and highlights identify active or discarded regions. Use those existing primitives for the first algorithm explanations.

Selecting elements offers the shared AI actions. The request retains the selected element IDs and revision even after focus moves to chat. A request must not accidentally attach a new selection made while generation is in progress.

Show proposed AI additions and modifications as a preview. Applying a proposal creates an undoable board step. Separate AI activity decoration from the student's actual diagram content.

## Computer

The computer opens a Python editor above a resizable output panel. It has one file, `main.py`.

Required controls and feedback:

- Syntax highlighting, indentation, line numbers, find, and undo/redo.
- Run and Stop; Run is disabled while the runtime is loading or another run is active.
- Runtime states: loading, ready, running, and error. A fresh Worker initializes after each run.
- Plain-text stdout and stderr, with a readable Python traceback and navigation to the relevant line.
- Explicit success when a program completes without printing anything.
- Clear output and a `.py` download action.
- A visible indication when output belongs to an older code revision.

There is no terminal prompt, REPL, command history, shell, debugger, or package-install interface. Inputs are edited directly in the Python example. Interactive `input()` is outside the MVP and should fail with an explanatory message rather than hang.

Output can be selected and attached to chat. A request such as "Show this step on the board" uses the selected run text plus its exact source revision.

## Journal

The journal opens one file, `notes.md`, with Edit/Preview controls. Support headings, lists, tables, fenced code, and links to workspace artifacts. Split editing and preview is optional desktop polish.

Save automatically, offer a `.md` download, and show local save status. Preserve user-written text when applying AI insertions. The default AI note action proposes an append rather than replacing the notebook.

Internal links open the corresponding tool and locate the source selection. If the current artifact has changed, show the referenced revision or saved excerpt with an outdated indicator. Exported Markdown retains readable source descriptions even when internal workspace links cannot function outside the app.

## Shared AI interface

Use a persistent, collapsible side panel on desktop and a drawer on smaller screens. Keep the same conversation when changing tools.

Display removable context chips such as "Board: 4 elements" or "Run 2: selected output." A visible activity label can say "Reading your diagram" or "Preparing a change to main.py" when those actions actually occur.

Provide Apply/Reject for proposals, Apply & Run for code, Stop for an active AI job, and a way to undo an accepted AI step. Completion should not automatically navigate away from the student's current tool.

## Keyboard and focus

| Action                         | Initial shortcut or behavior                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Run Python                     | Ctrl/Cmd+Enter when Code is active and focus is outside the chat composer                                                               |
| Flush local save               | Ctrl/Cmd+S within the workspace                                                                                                         |
| Switch to Board / Code / Notes | Alt+1 / Alt+2 / Alt+3; user configuration is not implemented                                                                            |
| Escape                         | Dismiss the current menu/dialog, exit maximization, or close the focused chat composer; never navigate to the desk |
| Navigate objects               | Ordinary Tab order through named DOM buttons; Enter/Space opens the tool                                                                |

Scope handlers so chat, Excalidraw, editor commands, browser shortcuts, and text composition do not conflict. Expose visible alternatives to every shortcut.

Restore the prior editor focus, selection, and scroll position when reopening it. Returning to the desk focuses the button for the object just closed. Inactive tools must be hidden and inert, including exclusion from assistive technology navigation. Announce AI completion without moving focus.

## Reduced motion and smaller screens

Respect `prefers-reduced-motion`: use an immediate view change or brief opacity transition without camera travel.

Desktop is the main editing target. Below a 680 px scene-container width, or when WebGL is unavailable, use large object cards with the same labels, previews, and navigation. The chat becomes a drawer below 800 px. On intermediate sizes, retain the desk only if all objects remain clear and easy to activate.

Remember the user's simple/3D desk preference across reloads. A narrow viewport temporarily shows one editor without replacing the recoverable desktop arrangement.

Show one tool at a time, stack code and output, and collapse chat into a drawer. Editing must remain available if the scene fails, loses its graphics context, or performs poorly.

## Preview updates and essential polish

Update text previews after a short idle period or when leaving a tool. Generate a board thumbnail on exit or idle; do not render a new texture on every pointer movement or keystroke. Previews derive from document revisions and never become a separate editable copy.

Recognizable objects, visible labels, focus states, a return path, and state preservation are essential. Animated journal pages, live monitor textures, particles, reflections, room decoration, and an animated companion are optional.

See [architecture](architecture.md) for state ownership and [implementation plan](implementation-plan.md) for acceptance checks.
