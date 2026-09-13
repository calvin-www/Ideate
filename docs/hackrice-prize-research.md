# HackRice 16 / 7.1 prize-entry research for Ideate

**Accessed:** 2026-09-13  
**Question:** What is the largest number of HackRice 2026/7.1 challenges that Ideate can enter honestly, and what is the smallest coherent product scope that supports those entries?

## Executive answer

The project should submit **one track only—Work & Productivity—and multiple named challenges**. The handbook says “choose at most 1 track” and “choose multiple challenges,” so the track is not a reason to avoid sponsor/API challenges. 

The most defensible maximum is **up to 11 named challenges plus the Work & Productivity track**:

* all **8 MLH provider challenges** on the official prize page (Gemini, ElevenLabs, Solana, Tiger Data, Presage, Vultr, Backboard, and GoDaddy Registry), provided the project demonstrably uses each service or completes the stated registration/deployment requirement;
* the separately listed HackRice **Best Project Built with ElevenLabs** challenge—the current Devpost exposes this and the MLH ElevenLabs prize as two distinct entries;
* **Persona: Prove you’re human**;
* **Notability: Trust the Process** (only if the team actually uses Notability Pro during the hackathon and can show that use).

This is a target, not a claim that the current checkout is eligible today. Ideate already has substantive Gemini code and an ElevenLabs voice path. The other six MLH entries need focused additions or deployment evidence. Persona and Notability are conditional on their published requirements. Capital One, MathWorks, the Healthcare/Finance/Games tracks, and handbook-only or unspecified items should not be added merely to increase the count: they would require a different product or are not selectable on the current Devpost.

## Sources and interpretation

* The organizer’s primary source is the [HackRice 16 Hacker Handbook](https://docs.google.com/document/d/1lqTThw7-FnLS0I7OSM_q0o2_Ls0L5AAMccHT4Ibrwkw/edit?tab=t.0#heading=h.w84eedjuq8kr). It contains the track/challenge text and the submission rule. The supplied Google Doc is a handbook, not a separate Ideate design brief.
* The current [HackRice 16 Devpost](https://hackrice-16.devpost.com/) is the form-facing source of truth. As accessed September 13, it lists 20 prizes: 3 overall awards, 4 mutually exclusive tracks, and 13 challenges. It lists two distinct ElevenLabs challenges, but it does not list Lilie Lab or Goldman Sachs.
* The MLH primary source is [Prizes at HackRice](https://www.mlh.com/events/hackrice-71/prizes). Its page says the prizes are won by “competing in one of these challenges and using new APIs,” then describes the eight provider challenges.
* Ideate’s current product and architecture are documented in the repository’s [product definition](product.md), [technical architecture](architecture.md), [AI collaboration contract](ai-collaboration.md), and [implementation status](implementation-status.md). Those files, plus the source tree, are the primary evidence for what is already built.
* Provider documentation is used only to make an integration proposal concrete: [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [ElevenLabs realtime speech-to-text](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime), [ElevenLabs streaming TTS](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming), [Backboard SDK overview](https://docs.backboard.io/sdk/quickstart), [Solana core concepts](https://solana.com/docs/core), [Solana writing to the network](https://solana.com/docs/intro/quick-start/writing-to-network), [Tiger Data/PostgreSQL documentation](https://docs.tigerdata.com/), and [Presage SmartSpectra](https://smartspectra.presagetech.com/).

“Eligible” below means “the submission can show the required use and a coherent product reason,” not “the sponsor must award the prize.” The MLH page does not publish a formal exclusivity rule for its eight challenges; the event handbook’s one-track/multiple-challenges rule is the governing submission guidance found here.

## What Ideate is now

Ideate is a personal 3D study desk: a student draws an algorithm on a whiteboard, connects it to a Python file, runs experiments, and records the lesson in a Markdown journal. A shared Gemini collaborator reads the selected artifacts, explains the student’s attempt, proposes reviewed board/code/note operations, and grounds explanations in actual run output. The app currently stores the workspace in browser IndexedDB and runs Python locally in a separate-origin Pyodide worker; it has no account, cloud sync, or public deployment.

The codebase also contains a voice vertical slice: the [voice transport](../src/features/voice/transport.ts) opens ElevenLabs realtime transcription, the [server](../src/features/voice/server.ts) streams ElevenLabs speech output, and [voice session state](../src/features/voice/useVoiceSession.ts) keeps Gemini as the study partner. Treat this as **implemented in source but requiring a live credential/demo check**, because the repository’s status document still describes voice as outside the older MVP scope. Do not claim a working live ElevenLabs demo until the configured account, microphone, and voice are tested.

## Official MLH prize challenges

| Challenge and published criterion | Current evidence | Smallest coherent addition / proof | Assessment |
|---|---|---|---|
| **Best Use of Gemini API.** Build an AI-powered app with Gemini; the page gives conversational advice, summarization, and creative generation as examples. | Already the product AI. The repo documents server-side `@google/genai`, multimodal board context, streamed responses, and validated function calls. | Keep the binary-search teaching demo: Gemini reads the diagram and actual Python trace, then proposes a grounded note/diagram change. Preserve evidence in the submission video. | **Count now.** |
| **Best Use of ElevenLabs.** Deploy natural, human-sounding audio; integrate “fully autonomous audio experiences” such as voice-enabled apps. | `src/features/voice` contains realtime Scribe transcription, streamed TTS, voice controls, and Gemini teaching steps paired with visible edits. | Verify `ELEVENLABS_API_KEY` and voice ID, rehearse microphone permissions, and show a short voice teaching step: student asks aloud, Gemini explains, audio and board writing play together. | **Count after live verification.** |
| **Best Use of Solana.** Use Solana’s fast/low-cost network; examples include high-frequency consumer/social apps, trading/lending/DEXs, or prototypes for supply chain, identity, or payments at real-world volume. | No Solana dependency or wallet in the current app. | Add an explicit “proof-of-learning identity” mode: connect a wallet on devnet, then write a real on-chain, non-transferable study-achievement/lesson attestation after an accepted run. Show the signed transaction and explain why the identity/credential is useful. Do not add a decorative wallet button or claim mainnet financial utility. | **Conditional, medium confidence.** It is legitimate only if the on-chain identity/credential is a real product flow and the demo performs a transaction. |
| **Best Use of Tiger Data.** Use Tiger Data’s PostgreSQL extension for real-time data, time-series metrics, complex analytics, dashboards, or high-volume data; the page asks teams to show an innovative, impactful, performance-driven use. | Current persistence is local IndexedDB; no server database or analytics. | Add an opt-in study telemetry stream and a small live dashboard backed by Tiger Data: run start/completion, target changes, hint requests, execution duration, and learning-note events. Use time-series queries/continuous aggregates to show progress and current session latency. Keep raw board/code private and document the opt-in boundary. | **Count after integration and demo.** Merely mentioning PostgreSQL is not enough. |
| **Best Use of Presage.** Use Presage human-sensing SDKs for real-time physical/emotional state; published examples include wellness, accessibility/security, gaming, and productivity tools that track focus/stress. | No camera sensing or Presage code. | Add an opt-in “focus-aware study mode.” Use Presage’s documented engagement/focus or wellness metrics to change explanation pacing, offer a break, or simplify the next prompt. Show the metric-to-UI behavior, consent, and a non-medical disclaimer; never diagnose stress or health. | **Count after SDK integration and privacy-safe demo.** |
| **Best Use of Vultr.** The page positions Vultr cloud compute/GPUs and one-click deployment as the challenge; it asks hackers to sign up, claim credits, and bring the project to the cloud. | The app and Python runner are localhost-only; architecture explicitly says nothing is deployed. | Deploy the app and runner to Vultr (a small CPU instance is enough for the web/runner; GPU is optional unless actually used), document the deployment, and demo the hosted URL. Keep Gemini/ElevenLabs keys server-side and add the production origin/runner security configuration before public access. | **Count after deployment evidence.** This is infrastructure work, not a new product concept. |
| **Best Use of Backboard.** Backboard supplies persistent AI memory, RAG, embeddings, tool calls, model routing, and context that survives pages/sessions; the page asks for a seamless persistent user experience. | Ideate has conversation persistence in local IndexedDB, but Gemini is the model and there is no external long-term memory service. | Add Backboard as a study-memory layer, not a second agent: save accepted misconception/insight summaries and source references, retrieve them when a new session starts, and let Gemini use those memories when adapting hints. Keep the existing proposal/revision executor authoritative. | **Count after integration and visible cross-session demo.** |
| **Best Domain Name from GoDaddy Registry.** Register the project’s domain name with GoDaddy Registry. | No domain is documented; the app is localhost-only. | Choose and register a concise project domain, point it at the Vultr deployment, and show the domain in the submission/demo. Registration must actually be completed before claiming this challenge. | **Count after registration.** Do not count a suggested name or an unregistered placeholder. |

### MLH maximum

The maximum MLH count is therefore **8**, but only Gemini is clearly evidenced by the current product documents. ElevenLabs is nearly there in source and needs live verification. Solana, Tiger Data, Presage, Vultr, Backboard, and GoDaddy each require the concrete proof listed above.

## HackRice handbook challenges and tracks

These are separate from the eight MLH cards and are included because the supplied organizer handbook publishes them.

| Handbook item | Published eligibility/criterion | Fit and recommendation |
|---|---|---|
| **Work & Productivity track** | Solve a real productivity pain point; reduce friction; make something users would keep using. Examples include task/project management, focus/attention, collaboration, and learning/classroom tools. | **Best and current track.** Ideate directly connects a student’s diagram, executable experiment, explanation, and notes to reduce context switching. Choose this one track. |
| **Healthcare track** | Build a user-facing longevity/healthspan application connecting layers such as aging biology, biomarkers/diagnostics, lifestyle, environment, and social connection into actionable guidance. | Do not enter with Ideate merely because Presage can sense focus. That would misrepresent the product as a longevity/healthspan application. |
| **Finance track** | Build personal wealth-management tools: budgeting, money tracking, planning, personalized financial insight, goals, bills, subscriptions, or cash-flow forecasting. | Not a fit. Do not bolt finance onto a study desk. |
| **Games & Gamification track** | Build a genuine game or use game mechanics (points, progression, challenges, rewards) to make a task rewarding. | Possible only by choosing this instead of Work & Productivity and making gamified learning central. It does not increase the count because the handbook permits at most one track. |
| **Persona — Prove you’re human** | Build something whose access depends on a verified human and make the checkpoint pleasant. The handbook specifically points to Persona’s free sandbox, web widget/hosted link, SDKs, and pass/fail demo toggle. | **Strong small addition.** Gate starting an AI/voice study session (not merely a decorative signup) on Persona sandbox verification, explain that it prevents bot consumption of costly AI/voice resources, and demo pass/fail paths. |
| **Capital One — Best Financial Hack** | Build an innovative banking/financial application leveraging mock accounts, merchants, bills, and P2P data through the Nessie API; the handbook says Nessie is optional if it is working. | Not coherent with Ideate. Enter only if the product is deliberately changed into a financial learning tool and the finance track is selected; that sacrifices the stronger Work & Productivity story. |
| **Lilie Lab AI Challenge [RICE ONLY]** | Build an AI application/tool/platform that solves a pressing problem; the handbook explicitly marks this challenge “RICE ONLY.” | Strong thematic fit if eligible, but **it is absent from the current Devpost prize list**. Do not count it unless the actual submission form exposes it or an organizer confirms how to enter it. |
| **MathWorks — Best Use of MathWorks** | Use MathWorks tools for the bulk of the project; base the final product on an in-silico medicine physical model from MathWorks documentation or one created by the team; solve a real problem. Agentic AI with MATLAB/Simulink is optional. | Not a minimal addition. The current Python algorithm desk neither uses MathWorks for the bulk nor centers an in-silico medicine model. Do not claim this from a token MATLAB screenshot. |
| **Notability — Trust the Process** | Build with Notability Pro during the hackathon; recommended uses include ideation, brainstorming, discussion summaries, and wireframing; the best use wins. | **Conditional process challenge.** Use Pro materially during planning and capture a dated artifact that informed the shipped desk/demo. Do not imply the web app integrates Notability unless an actual import/export integration is built. |
| **Goldman Sachs** | The handbook says Goldman Sachs will offer a challenge, but says “more details to come.” | Cannot assess or count until the organizer publishes the criterion. |
| **Ken Kennedy Institute / Rice Engineering Alumni** | The handbook supplies background descriptions but no named challenge or eligibility criterion. | Cannot count as challenges without organizer rules. |
| **Overall prizes** | First/second/third prizes are listed, but they are overall awards rather than additional challenge entries. | Do not count them in the challenge total; a strong submission may still compete for them. |

The handbook also lists an ElevenLabs sponsor challenge, “Best Project Built with ElevenLabs,” with a three-month Scale-tier prize for each team member. The current Devpost exposes it separately from “[MLH] Best Use of ElevenLabs,” so one substantive, live ElevenLabs integration can support **two challenge entries**.

## Minimal coherent build sequence

1. **Preserve and evidence the core:** binary-search study loop, Gemini explanation/function call, actual Python output, and source-linked note. Select Work & Productivity.
2. **Verify the existing voice path:** configure ElevenLabs, test realtime transcript and streamed speech, and record a short interruption-safe voice teaching demo.
3. **Add trust at the session boundary:** Persona verification before starting AI/voice work. Keep the sandbox pass/fail toggle and make the purpose explicit.
4. **Add durable AI learning memory:** Backboard stores only accepted learning summaries/references; retrieve them on a later session so the study partner adapts. Do not replace Ideate’s local document/revision authority.
5. **Add an opt-in learning analytics slice:** Tiger Data receives bounded event records and powers a small real-time/time-series dashboard. Avoid uploading full private artifacts by default.
6. **Add focus-aware pacing (optional):** Presage metrics adjust the study interaction, with camera consent and a general-wellness disclaimer. This is the only health-adjacent addition; do not relabel Ideate as a longevity app.
7. **Add an honest on-chain identity artifact (optional but required for Solana):** devnet wallet + a real study-achievement attestation after a completed run. Show the signed transaction and why it helps a learner/mentor verify progress; do not claim financial or high-volume performance without measuring it.
8. **Deploy, then register:** deploy the web app/runner to Vultr, validate origin/CSP/secrets, and register a GoDaddy domain pointing to that deployment.
9. **Use Notability Pro in the actual hackathon process:** create the wireframe/lesson storyboard there and retain the required detailed note and at least two screenshots.

This sequence keeps every addition attached to the same study loop: identity protects access, memory carries learning forward, analytics measures the loop, sensing adjusts the loop, Solana attests to the loop, and Vultr/GoDaddy make the finished loop reachable. If time runs short, drop Solana and Presage before weakening the core study demo; do not submit a provider name without a visible, working product use.

## Submission/evidence checklist

For each selected challenge, put the service, the concrete feature, and the demo proof in the Devpost description/video. The handbook requires a 3–4 minute video with project purpose, demo, technical design, and impact, and live judging is only three minutes (two-minute demo plus one-minute Q&A). Capture one short proof per service rather than trying to explain every integration verbally.

Do not claim:

* a cloud deployment while the app is still localhost-only;
* an ElevenLabs prize from code that has not been tested with a live key;
* Solana from a wallet connect with no signed transaction or product purpose;
* Tiger Data from a local JSON/IndexedDB dashboard;
* Presage from ordinary webcam permission or an unvalidated medical claim;
* Backboard from ordinary local conversation persistence;
* GoDaddy from an unregistered domain;
* Lilie unless it appears in the actual submission form or an organizer confirms a separate entry route; or
* Goldman, Ken Kennedy, REA, MathWorks, Finance, or Healthcare without the missing/substantive criteria.

The defensible submission story is therefore: **one Work & Productivity track, eight MLH provider challenges after the listed proof work, the separate HackRice ElevenLabs challenge, Persona, and Notability with real process evidence—11 challenge entries total.** The current form contains 13 challenges; the two deliberately omitted ones are Capital One and MathWorks because they require a material product pivot.
