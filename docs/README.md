# Ideate documentation

Ideate is a 3D study desk for understanding algorithms through drawing, Python experimentation, and explanation with an AI collaborator.

**Status:** Implementation was explicitly authorized and is now present. See [implementation status](implementation-status.md) for delivered behavior, verification, and remaining limits. Deployment has not been requested or performed.

**Planning date:** September 12, 2026. **Event:** HackRice 16. **Intended track:** Work & Productivity.

## Reading order

| Document | Purpose |
| --- | --- |
| [Implementation status](implementation-status.md) | What is built, how to run it, and verification evidence |
| [Product](product.md) | Audience, learning workflow, scope, and product success criteria |
| [Interaction design](interaction-design.md) | Desk layout, tool interfaces, navigation, accessibility, and previews |
| [Architecture](architecture.md) | Stack, state ownership, persistence, Python isolation, and data model |
| [AI collaboration](ai-collaboration.md) | Gemini integration, teaching behavior, context, operations, and edit safety |
| [Implementation plan](implementation-plan.md) | Sequential solo milestones, feasibility checks, acceptance criteria, and demo |
| [Decisions and sources](decisions-and-sources.md) | Accepted decisions, repository findings, organizer clarification, and documentation references |

## Working agreement

- Preserve the feeling of explaining an idea on paper and passing the pencil between a student and an AI study partner.
- Use a 3D desk to open readable, full-size 2D tools.
- Start with one whiteboard, one Python file, one Markdown notebook, and one shared conversation.
- The computer needs Run/Stop, basic Python output, and errors. A terminal, REPL, shell, and package manager are outside the agreed scope.
- Use Gemini for product AI. Astra can assist with development and static assets.
- One lead implementer coordinates the work; the user explicitly authorized subagents for bounded parallel tasks. No submission countdown is assumed.
- Treat the earlier Ideate as design reference. The default is a fresh implementation.

The latest user decisions take precedence over earlier proposals. The task-planner demonstration, OpenAI runtime default, Python console, and three-person time budget are superseded. The proposed demonstration is a binary-search study session.

## Boundaries

The product and interaction documents define the experience. The architecture and AI documents describe the implemented contracts and remaining limits. The implementation plan records the accepted milestone sequence.

External documentation was checked during planning on September 12, 2026. Implementation uses pinned dependencies and live account checks. Verification results are recorded separately from the original acceptance criteria.
