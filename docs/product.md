# Product definition

## Purpose

Ideate is a personal 3D study desk where a student can draw an algorithm, connect it to Python, observe what the code does, and record what they learned. An AI collaborator follows the same artifacts throughout the session.

The inspiration is sitting with a friend, explaining something on paper, and passing the pencil back and forth. Preserve that shared attention and turn-taking through useful actions on the workspace.

**Value proposition:** Work through an algorithm with an AI study partner using the same whiteboard, code, and notes.

## Primary user and problem

The primary user is a CS student studying algorithms or preparing for coursework or technical interviews. They may be able to follow an explanation without understanding why the algorithm works, how the diagram relates to code, or what changes for a different input.

Moving between a drawing app, code editor, notes, and a separate chat makes the student repeatedly reconstruct context. Ideate keeps the visual explanation, implementation, observed output, and personal learning notes connected.

For Work & Productivity, position the project around a coherent study workflow and less effort translating between representations. Do not claim measured learning improvements before evaluating the product.

## Core study loop

1. Express an attempt or question on the whiteboard.
2. Select the confusing part and ask for an explanation or hint.
3. Connect the visual model to a small Python implementation.
4. Run it and change an input to test a prediction.
5. Use actual execution output to explain the corresponding diagram state.
6. Record the insight, misconception, and supporting example in the notebook.

Returning to the desk or switching tools preserves the session. A student can start in any tool; the loop is a compelling example, not a forced wizard.

## Demonstration: understanding binary search

Use the sorted array `[2, 5, 8, 12, 16, 23, 38, 56]`, initially searching for `16`. The example uses inclusive `low` and `high` bounds and zero-based indices.

| Step | Student action | Collaborator behavior |
| --- | --- | --- |
| Attempt | Draw the array and label `low`, `mid`, and `high` | Read the selected elements and any relevant drawing image |
| Explanation | Ask, "Why can we discard this half?" | Explain using the sorted-order assumption and propose a diagram annotation |
| Implementation | Ask, "Show this in Python and print each step" | Propose a short implementation that prints bounds, midpoint, and comparison result |
| Experiment | Run, then change the target to `17` and run again | Use the actual successful and unsuccessful run outputs as evidence |
| Visual connection | Select an output step and ask, "Show this on the board" | Propose a static diagram of that recorded step |
| Reflection | Ask, "Add what we learned to my notes" | Propose session-specific notes with references to the board, source, and run |

For target `16`, the expected midpoint indices are `3`, `5`, and `4`. For target `17`, the interval eventually becomes empty and the result is not found. These are acceptance examples; the actual demo must display output from the implemented program.

The notebook should capture why a half can be discarded, why bounds move beyond the midpoint, and how the missing-target example terminates. Preserve the student's own questions and corrections.

Binary search is the first demonstration. The workspace remains general enough for sorting, recursion, graph traversal, and similar topics. Do not build a catalog of algorithm-specific applications for the MVP.

## What makes the AI a collaborator

- It responds to the student's actual attempt and selection.
- It connects a diagram element, code range, and output step when explaining a concept.
- It gives a hint when asked for a hint and a full solution when explicitly requested.
- It proposes visible, editable changes and lets the student take over immediately.
- It keeps one conversation across all tools.
- It distinguishes a prediction from an observed execution result.
- It records specific learning insights instead of automatically producing generic textbook notes.

Useful selection actions are **Explain visually**, **Give me a hint**, **Show this in Python**, and **Add this to my notes**. They are shortcuts into the same conversation, not separate AI modes.

Do not enforce a quiz before every answer or withhold requested explanations. The student controls the level of help.

## Scope

### Must have

- A recognizable 3D desk with functional computer, whiteboard, and journal objects.
- Readable 2D editing interfaces, direct tool navigation, and return to the desk.
- One Excalidraw board with drawing, text, shapes, arrows, and selection.
- One Python file with Run/Stop, basic printed output, and readable errors.
- One Markdown notebook with editing, preview, local save, and export.
- One shared Gemini collaborator with selected context and explicit operations across the tools.
- Proposed AI changes, Apply/Reject, undo, cancellation, and stale-edit protection.
- Local persistence and references linking explanations to their source artifacts.
- Keyboard navigation, reduced motion, and a functional 2D fallback.

### Polish after the complete study loop works

- Refined static desk assets and lighting.
- Board thumbnails and richer computer/journal previews.
- More polished transitions and subtle activity indicators.
- Better presentation of code changes and source references.

### Stretch, with separate scope decisions

- Animated algorithm playback or a trace timeline.
- Custom array, graph, or recursion widgets.
- Plots, extra Python packages, or multiple code files.
- Multiplayer, voice, an animated AI companion, authentication, multiple projects, and room customization.

On-demand 3D generation is not a product requirement. Development assistance may produce static assets that ship with the application.

## Assumptions to challenge

**3D can add navigation friction.** Keep a direct tool bar and make all editing available without camera interaction.

**Generating an answer is not the same as supporting understanding.** Encourage student predictions and experiments through the conversation without making them compulsory.

**Visual understanding can be ambiguous.** Prefer labeled shapes for the demo; ask a focused clarification when a freehand mark could change the explanation or implementation.

**Multiple editors alone do not provide continuity.** State preservation, shared context, and source references are core product work.

**Automatic animation is expensive.** Static diagrams tied to actual run output are enough to demonstrate the learning loop.

## Acceptance criteria

- A student can connect a selected diagram to runnable Python without manually copying the diagram into chat.
- Changing an input produces a new run that the AI can explain using its actual output.
- The AI can propose a board explanation of a selected run step.
- Notes retain the student's question and supporting source references.
- Manual edits survive navigation, accepted AI changes, and rejected stale responses.
- After a session, a student can use the artifacts to explain the example's key invariant. This is a qualitative evaluation goal, not a proven outcome.

See [interaction design](interaction-design.md) for the interfaces and [AI collaboration](ai-collaboration.md) for the teaching and operation contracts.
