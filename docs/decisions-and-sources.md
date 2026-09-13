# Decisions, reference inspection, and sources

## Decision record

These decisions reflect the user's accepted direction and corrections through September 12, 2026.

| ID | Decision | Status and rationale |
| --- | --- | --- |
| D01 | Focus on visually explaining algorithms and improving studying | User correction; replaces the task-planner demonstration |
| D02 | Preserve the paper-and-shared-pencil feeling | Original product intent |
| D03 | Use a 3D desk with computer, whiteboard, and journal | Confirmed core direction |
| D04 | Open readable 2D editors from the objects | Accepted recommendation; limits camera and text-input complexity |
| D05 | Use one board, Python file, notebook, and conversation | Accepted MVP scope |
| D06 | Provide basic Python output and errors | User clarification; removes terminal and Python-console features |
| D07 | Start with the Python standard library | User clarification; no special packages required |
| D08 | Use Gemini for runtime collaboration | User preference; accepted revised recommendation |
| D09 | Use gemini-3.8-flash | Account, text, image, and signature-preserving tool continuation verified; transient provider failures also observed |
| D10 | One lead implementer | No fixed countdown; user subsequently authorized subagents |
| D11 | Use local persistence and reviewed AI changes | Accepted safeguards and scope |
| D12 | Use binary search as the first study demonstration | Accepted revised recommendation; does not limit the general workspace |
| D13 | Use Astra for development and static assets if useful | Development role; on-demand 3D generation is not required |
| D14 | Target Work & Productivity | User's intended track; frame the value around connected study work |
| D15 | Treat the old project as design reference and default to fresh code | Original instruction and event reuse rules |
| D16 | Write planning documents into docs/ | Completed before implementation |
| D17 | Begin implementation | Explicitly authorized after planning; local build and verification allowed |
| D18 | Use bounded subagents | Explicit user instruction; scene, runner, Gemini, and review delegated |

## Current authorization

The user accepted the revised plan, requested documentation, then explicitly said to begin implementation and allowed subagents. Local implementation, dependency installation, and verification are authorized. Deployment and external communications have not been requested.

Do not turn the presence of an implementation plan into permission to execute it. Conversely, once the user explicitly requests building, the accepted product decisions do not need to be asked again unless new evidence changes them.

## Repository inspection

The local repository at `C:/Users/calvi/OneDrive/Desktop/github/Ideate` contained only Git metadata, with no commits, application files, or configured remote during the planning inspection. No applicable local or ancestor `AGENTS.md` was found.

The earlier implementation is [moyindavid16/ideate](https://github.com/moyindavid16/ideate). It was inspected through public source reads, not cloned, installed, or executed.

| Area | Finding | Design implication |
| --- | --- | --- |
| Dependencies | Next.js 15.5.3, React 19, Excalidraw, CodeMirror, Pyodide, Mastra, and AI SDK are listed | Familiar library choices are reference material, not a compatible version set for the new app |
| Interface | Tool tabs and split groups exist | Preserve the three tools while replacing tab-centric navigation with a desk |
| Drawing | Excalidraw scene handling and context extraction exist | Use structured elements and selected image context |
| AI routing | The chat route chooses code, Markdown, or drawing handlers based on active tool | Replace per-tool dispatch with shared operations and context |
| State | The inspected tab provider keeps document data in memory; run output is component-local | Move persistent artifact ownership above navigation |
| Python | The inspected editor calls Pyodide from the main thread; the manager eagerly loads NumPy/Matplotlib | Use a Worker and avoid unnecessary packages |
| Licensing | No license file was found in the inspected tree | Do not infer permission to copy application code or assets |

Source reads: [package.json](https://github.com/moyindavid16/ideate/blob/main/package.json), [tab context](https://github.com/moyindavid16/ideate/blob/main/contexts/tab-context.tsx), [chat route](https://github.com/moyindavid16/ideate/blob/main/app/api/chat/route.ts), [Python editor](https://github.com/moyindavid16/ideate/blob/main/components/code-editor.tsx), [runtime manager](https://github.com/moyindavid16/ideate/blob/main/lib/pyodide-manager.ts), [board integration](https://github.com/moyindavid16/ideate/blob/main/components/visual-canvas.tsx).

These are static inspection findings, not a comprehensive review or a claim that the old application currently works.

## Organizer clarification

HackRice 16's published FAQ, question 32, says project work must be started and completed during the event, disallows work from before the hacking start, and requires attribution for boilerplate/templates. The schedule lists September 13, 2026 at 9:00 a.m. Houston time as the hacking end. Check the event's latest announcements before submission. [HackRice website and FAQ](https://hackrice.com/)

The default plan is a fresh implementation. Seek organizer clarification before relying on any exception for:

- Continuing the earlier concept and name, including the appropriate disclosure of the reference project.
- Reusing specific old adapters, prompts, artwork, or other assets and whether any qualify as permitted attributed templates.
- Submission attribution and any applicable rules for AI-assisted development or generated assets.

Permission from original contributors and organizer eligibility are separate matters. No organizers or contributors have been contacted in this task. Unresolved reuse questions do not require importing old code; the fresh-build path remains the default.

## Technical documentation checked

Sources were checked during planning on September 12, 2026. The documentation supports the listed capabilities; the integration still needs implementation-time validation.

| Source | What it supports |
| --- | --- |
| [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) | Stable model identifier, image input, function calling, structured outputs |
| [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling) | Application-defined functions and returning actual tool results |
| [Google GenAI libraries](https://ai.google.dev/gemini-api/docs/libraries) | Supported SDK approach, including JavaScript/TypeScript |
| [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading) | Client-only loading of browser-dependent components |
| [React Three Fiber scaling performance](https://github.com/pmndrs/react-three-fiber/blob/master/docs/advanced/scaling-performance.mdx) | On-demand rendering and explicit invalidation for camera changes |
| [Excalidraw API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api) | Scene reads, updates, change subscriptions, refresh, and undo capture |
| [CodeMirror guide](https://codemirror.net/docs/guide/) | Editor state, selections, and transaction-based updates |
| [Zustand persistence](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data) | Custom asynchronous storage and hydration behavior |
| [react-markdown](https://github.com/remarkjs/react-markdown) | Markdown rendering and the implications of enabling raw HTML/plugins |
| [Pyodide in a Worker](https://pyodide.org/en/stable/usage/webworker.html) | Running Python off the main thread |
| [Pyodide streams](https://pyodide.org/en/stable/usage/streams.html) | Standard output and error stream handling |
| [Pyodide interruption](https://pyodide.org/en/stable/usage/keyboard-interrupts.html) | Shared-memory requirements for graceful interruption |
| [MDN Worker guide](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) | Worker capabilities, messaging, termination, and security policies |
| [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/sandbox) | Restrictions available for embedded runner content |

## Remaining validation

- Confirm Gemini access, limits, latency, and quality with the actual implementation account after building is authorized.
- Select compatible pinned package/runtime versions; no dependencies were installed during planning.
- Prove the runner's origin restrictions, termination, and error reporting in a browser.
- Prove editor lifecycle, persistence ordering, source references, and stale-edit protection.
- Evaluate graphics performance and keyboard/focus behavior on the demonstration device.
- Clarify any intended prior-work reuse before taking that route.

The user has already settled the audience, Python scope, preferred AI provider, and solo-build assumption. There are no outstanding product questions needed merely to preserve this plan in documentation.
