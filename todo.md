# Project TODO

- [x] Define user-scoped relational schemas for projects, missions, mission messages, execution runs, execution events, model configurations, and provider diagnostics.
- [x] Add server-side provider abstraction and model registry that reports only callable configured models.
- [x] Add secure server-only environment configuration for provider credentials without exposing keys to the client.
- [x] Add a registry-based provider configuration workflow with host-environment credentials, live verification, and no chat-based credential collection.
- [x] Implement validated tRPC procedures for model discovery, projects, missions, execution submission, retry, events, competition runs, and operations diagnostics.
- [x] Implement a real execution service that records outcomes, latency, provider errors, usage metadata, and an immutable event timeline from actual requests.
- [x] Implement competition execution that compares genuine independent results without fabricating a winner.
- [x] Build a persistent, responsive navigation rail and cyber-command-center workspace with accessible controls and reduced-motion-safe interactions.
- [x] Build mission command, model availability, run result, event timeline, competition, and operations-console interfaces with loading, empty, error, and unavailable states.
- [x] Add technical grid, scanline, HUD, neon accent, and purposeful motion treatments while preserving responsive readability and accessibility.
- [x] Add automated tests for user scoping, callable model filtering, execution state transitions, failure handling, and competition result integrity.
- [x] Run database migration, test suite, typecheck, build verification, and visual inspection; resolve discovered issues.
- [ ] Create a final project checkpoint after all checklist items are verified complete.
- [x] Verify user-scoped access, callable-model filtering, retry behavior, and the authenticated command-center experience before final delivery.
- [x] Run service-level failure and retry tests, then reconcile final verification evidence before the checkpoint.
