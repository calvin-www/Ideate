## Task 5: Integration verification and live acceptance

**Files:** Update `README.md`, `docs/ai-collaboration.md`, and this plan's progress record, touching only voice sections.

- [ ] Run `npm run typecheck`, the unit suite, targeted AI/editor/voice browser tests, and production build. Inspect every result.
- [ ] Review the diff against the spec: concurrency, cancellation, stale events, persistence, credentials, and text-mode behavior.
- [ ] When credentials are present, perform the binary-search live demonstration and report measured timing and audible quality separately from fixture results.
- [ ] If credentials are unavailable, finish all local verification and clearly report that account-backed speech and microphone quality remain unverified.

