# Changelog

This changelog records meaningful planning and implementation changes between commits. Keep an `Unreleased` section during active work, then move entries into a dated section when a commit or release boundary is created.

## Unreleased

### Added

- Added the master plan for the mobile remote control platform.
- Added the MVP plan centered on Codex Remote Control Alpha.
- Added the continuous checklist for milestone and slice tracking.
- Linked planning documents from the README.
- Added long-term execution and storage strategy, including Adam-hosted limits, bring-your-own storage, and bring-your-own runner options.
- Added a recommended technology stack for the MVP and later cloud-execution phases.
- Added implementation-ready normalized event schema documentation.
- Added adapter contract documentation for Codex CLI and future coding-agent integrations.
- Added architecture decisions for the free MVP, daemon, relay, storage, auth/pairing, and implementation layout.
- Added legal/safety risk register covering integration tiers, permissions, consent copy, retention, unsupported integrations, and launch gates.
- Added dependency-free documentation health checks and a GitHub Actions workflow.
- Added `.gitignore` protection for Adam runtime state, local databases, environment files, and token/secret-like files.
- Added Milestone 1 daemon implementation (`apps/daemon`) with config loading, repo/git detection, Codex availability and session discovery, local event logging, and health command.
- Added daemon tests and CI workflow for build/test/docs checks.
- Added integration surface research notes for Codex, Claude Code, GitHub Copilot, Antigravity, Cursor, and Cowork.
- Added Milestone 2 relay implementation (`apps/relay`) with pairing-code issuance, pairing exchange, bearer-token auth, daemon heartbeat ingestion, reconnect tracking, and user-scoped session/device listing.
- Added relay tests for production transport enforcement, bootstrap-key authorization, token expiry, and cross-user isolation.
- Added relay production startup protection that blocks default in-memory store usage unless explicitly overridden.
- Added relay transport and reconnect assumptions documentation for Milestone 2.
- Added Milestone 3 relay prompt flow with authenticated prompt submission, daemon prompt dequeue, prompt status transitions, and user-scoped event feed endpoints.
- Added daemon relay worker command (`relay-once`) that heartbeats, pulls queued prompts, forwards prompts to Codex, and reports acknowledged or failed delivery states.
- Added web client prototype (`apps/web`) with prompt composer, session picker, relay-backed activity feed polling, and explicit error-state rendering.
- Added relay and daemon tests for prompt lifecycle, delivery failures, and worker behavior, plus web template tests and CI coverage for `@adam/web`.
- Added session-scoped remote-prompt consent gating, prompt idempotency via `clientPromptId`, and lease-based prompt recovery protections.
- Added device-scoped relay session identifiers for prompt routing so prompts target the intended daemon session.
- Added daemon prompt-worker checks for attached session matching and prompt lease window safety before Codex execution.
- Hardened web proxy token handling by removing bootstrap token exposure and moving token transport out of query strings.
- Added connector architecture documentation covering the plugin model, the relay-held credential vault, the scope and permission model, the MCP and REST exposure surfaces, and the mobile and computer integration story.
- Added cloud platform documentation covering the stateless relay and managed state posture, the Neon primary database with Aiven and Supabase fallbacks, the disposable-host deployment model, retention, the cost model, and the operational runbook.
- Added implementation plan artifacts under `docs/superpowers/plans/` for shared contracts, the cloud platform, the connector hub, and the agent adapters.
- Added OpenCode to the integration surface research, including the disambiguation between the active `anomalyco/opencode` project and the archived Go project that previously held the name, the MIT licence, the headless `opencode run --format json` interface, the `opencode serve` and `--attach` server-backed mode, MCP support with OAuth, and `OPENCODE_CONFIG_CONTENT` for per-invocation configuration injection.
- Refreshed the Claude Code and GitHub Copilot CLI sections of the integration surface research with current documented interfaces, including Claude Code's `--permission-prompt-tool` permission host, its `PermissionRequest` hook, its permission modes, and the `stream-json` output format, and Copilot CLI's `--connect` reconnection flag, its JSONL output format, its `--trust-folder` restriction, and its documented behaviour of skipping MCP connections in headless sessions without an OAuth handler.
- Promoted Claude Code and GitHub Copilot CLI from ingestion-only to full adapters in the platform strategy and the adapter contract, because both expose a documented mechanism for remote control.
- Added a permission host adapter section to the adapter contract, establishing that the relay's MCP server doubles as the permission transport so the phone-facing approval flow is written once rather than once per agent.
- Added an OpenCode capability target and a server-backed adapter section to the adapter contract, and added OpenCode to the adapter implementation order.
- Added research findings on Oracle Cloud Always Free, including the reduction of the Ampere A1 entitlement to 2 OCPU and 12 GB in August 2026, the idle reclamation thresholds, the immutable home region, the over-provisioning deletion rule, and the absence of any free managed Postgres on Oracle.
- Added research findings on Google OAuth scope tiers, showing that reading a mailbox is a restricted scope requiring an annual third-party security assessment while sending is only a sensitive scope, and that a client left in Testing publishing status issues refresh tokens that expire after seven days.
- Added an open-source licence audit of the current and planned dependency set, flagging Redis 8 as tri-licensed under RSALv2, SSPLv1, and AGPLv3 with Valkey as the permissively licensed substitute.

### Decisions

- Start with OpenAI Codex CLI as the first integration because it is the lowest-risk control surface.
- Treat Claude Code JSONL and GitHub Copilot official export as the next safest ingestion paths.
- Keep Cursor and Antigravity raw local parsing out of the MVP until legal and format risks are resolved.
- Make cloud-hosted execution a later milestone after local ingestion and relay are stable.
- Treat user-owned databases and object storage as advanced connectors for session state and artifacts, not as a replacement for execution infrastructure.
- Separate premium laptop-off execution from lightweight relay/storage features because agent runtime cost is driven by compute, workspace disk, dependency caches, and sandboxing.
- Prefer a TypeScript-first monorepo for MVP speed, with Postgres/Supabase for relay state, Expo React Native for mobile, Next.js for web, and Node.js TypeScript for the first daemon/API implementation.
- Use normalized events and explicit adapter capabilities as the foundation for the daemon, relay, mobile/web feed, permission gates, and future cloud runners.
- Keep the feasibility MVP free/low-cost by building a responsive web/PWA first, using local JSONL event logs plus Supabase/Postgres free-tier relay state, and deferring native mobile, hosted execution, BYO connectors, billing, and sandbox infrastructure.
- Treat pre-permission-gate remote prompt forwarding as local/dev-only until session-level consent, audit events, and blocked approval-state visibility are in place.
- Use stdin-driven `codex exec --json` parsing patterns from real external integrations for safe prompt forwarding and resilient event normalization.
- Keep Cursor and Cowork integration in research-only status until official, verifiable surfaces and terms are confirmed.
- Keep the in-memory relay store as a Milestone 2 development implementation and block default production startup until persistent shared storage is wired.
- Keep Milestone 3 remote prompting scoped to explicit delivery-state visibility and failure transparency before introducing higher-risk approval-gated actions.
- Require explicit per-session remote prompt consent and idempotent delivery semantics before prompting is treated as safe for routine use.
- Introduce a single shared contracts package so the daemon, relay, and web client stop maintaining parallel hand-written type definitions, and make it a prerequisite for the connector work.
- Keep the relay process stateless and hold all durable state in a managed database, so losing the compute host becomes a redeploy rather than a data loss.
- Use Neon Free as the primary relay database and treat Oracle Always Free as a disposable host rather than the system of record, because idle instances are reclaimed, the home region is immutable, and Oracle offers no free managed Postgres.
- Execute connector calls in the relay rather than on the user's machine, so the phone remains useful while the laptop is asleep and the agent never holds a provider credential.
- Expose connector capabilities to the agent over MCP with Streamable HTTP in stateless mode, and reuse the existing permission gate for connector actions rather than building a second approval mechanism.
- Fix a connector grant at connection time and check it before the risk tier, so a request can never widen what the user approved.
- Request the narrowest Google scopes that work, starting with `gmail.send`, and treat `gmail.readonly` as an explicit decision to accept restricted-scope verification and an annual security assessment.
- Publish the Google OAuth client to In production publishing status from the outset, because Testing mode issues refresh tokens that expire after seven days.
- Fail closed on a revoked or expired connector grant, blocking further use and notifying the phone rather than retrying or serving stale data.
- Add OpenCode as the second full adapter, ahead of Claude Code and Copilot, because it is MIT licensed, publishes a documented JSON event stream, speaks MCP with OAuth, and can run against local models.
- Drive OpenCode in server-backed mode through `opencode serve` and `--attach`, so the MCP connection to the connector hub stays open across prompts instead of repeating an OAuth handshake on every turn.
- Inject the relay MCP endpoint through `OPENCODE_CONFIG_CONTENT` rather than editing the user's own `opencode.json`.
- Detect optional CLI flags at runtime and never pass a flag that suppresses a tool's own permission flow, because forwarding that approval to the phone is the product.
- Read OpenCode session history through `opencode export` rather than opening the session database, so the adapter is not coupled to an undocumented schema.
- Use Claude Code's `--permission-prompt-tool` as the permission host so the relay's MCP server answers approval requests, rather than building a separate approval channel per agent.
- Never use Claude Code's `--dangerously-skip-permissions` or `--permission-prompts none` while a human can answer, because both convert an approval into a denial.
- Use GitHub Copilot CLI's `--connect` flag for reconnection, since it exists specifically for remote control, and never combine `--trust-folder` with a resumed session.
