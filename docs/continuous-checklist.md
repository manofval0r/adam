# Continuous Checklist

This checklist is the live execution tracker for the project. Update it whenever the active milestone or slice changes. Completed slices should stay checked so the project history remains easy to scan.

## Current position

| Field | Value |
| --- | --- |
| Current phase | Milestone 4: Decision and permission gates |
| Current slice | Slice 4.1: Decision and permission event surfaces |
| Primary platform | OpenAI Codex CLI |
| Current risk focus | Keep approvals explicit and auditable before enabling higher-risk remote actions |
| Next milestone | Milestone 5: Durable platform, once Milestone 4 completes |
| Plan artifacts | `docs/superpowers/plans/` holds the task-by-task plans for Milestones 4, 5, 6, and 7 |

## Milestone 0: Foundation and planning

### Slice 0.1: Planning documentation

- [x] Create master plan.
- [x] Create MVP plan.
- [x] Create continuous checklist.
- [x] Create changelog.
- [x] Link planning docs from README.
- [x] Add recommended technology stack to planning docs.
- [x] Draft normalized event schema in implementation-ready detail.
- [x] Draft adapter contract.
- [x] Draft legal/safety risk register.
- [x] Add architecture decisions.
- [x] Add GitHub Actions documentation health check.

### Slice 0.2: Architecture decisions

- [x] Choose desktop daemon runtime.
- [x] Choose mobile app stack.
- [x] Choose cloud/API stack.
- [x] Confirm TypeScript monorepo package layout.
- [x] Confirm shared schema/contract tooling.
- [x] Confirm Postgres/Supabase versus self-hosted Postgres for first relay.
- [x] Confirm WebSocket/SSE transport boundaries.
- [x] Choose storage model for relay state.
- [x] Define Adam-hosted versus user-owned storage boundaries.
- [x] Define repo, artifact, and retention limits for free/light usage.
- [x] Define bring-your-own storage connector requirements.
- [x] Define bring-your-own runner/workspace connector requirements.
- [x] Choose local daemon config format.
- [x] Define local event log format.
- [x] Define auth and pairing flow at a technical level.

### Slice 0.3: Legal and safety preparation

- [x] Classify integrations into green/yellow/red risk tiers.
- [x] Write permission model for shell, file, repo, network, and system access.
- [x] Write user consent copy for dangerous actions.
- [x] Write data retention assumptions.
- [x] List questions for legal review.
- [x] Mark unsupported/experimental integrations clearly.

## Milestone 1: Local daemon prototype

### Slice 1.1: Daemon skeleton and repo detection

- [x] Create daemon package/app skeleton.
- [x] Add local configuration loading.
- [x] Detect current repo path.
- [x] Detect current branch and git status.
- [x] Detect Codex CLI availability.
- [x] Detect or resume one Codex session.
- [x] Emit local `session_started` event.
- [x] Emit local `activity` events.
- [x] Write local event log.
- [x] Add local health command or endpoint.
- [x] Add basic daemon tests.
- [x] Add CI workflow for docs + daemon checks.

## Milestone 2: Cloud relay and pairing

### Slice 2.1: Relay skeleton and device model

- [x] Create relay API skeleton.
- [x] Add user/device model.
- [x] Add pairing flow.
- [x] Add daemon heartbeat.
- [x] Add client session list.
- [x] Add encrypted transport assumptions.
- [x] Add reconnect behavior.
- [x] Add relay tests.

## Milestone 3: Mobile prompt and activity feed

- [x] Create mobile/web prompt UI.
- [x] Create activity feed UI.
- [x] Sync events from relay to client.
- [x] Submit prompt from client to relay.
- [x] Relay prompt from daemon to Codex.
- [x] Display prompt delivery state.
- [x] Display failure states.
- [x] Validate one full phone-to-Codex-to-feed loop.

## Milestone 4: Decision and permission gates

Plan: `docs/superpowers/plans/2026-10-24-shared-contracts.md` (Tasks 1 and 2)

### Slice 4.0: Shared contracts foundation

The decision and permission events cannot be defined twice. The event envelope and the permission vocabulary are pulled forward from Milestone 5 because this milestone depends on them.

- [ ] Add `packages/contracts` workspace package with Zod schemas.
- [ ] Add event envelope schema with a closed event type union.
- [ ] Add permission request and decision schemas.
- [ ] Route daemon and relay event and permission types through the shared package.

### Slice 4.1: Decision and permission event surfaces

- [ ] Add `decision_request` event.
- [ ] Add `permission_request` event.
- [ ] Add mobile approval/rejection UI.
- [ ] Add shell/system access consent screen.
- [ ] Add audit log for decisions.
- [ ] Add push notification for blocked agent.
- [ ] Prevent dangerous actions without explicit approval.

## Milestone 5: Durable platform

Plan: `docs/superpowers/plans/2026-10-24-cloud-platform.md`

### Slice 5.1: Durable relay state

- [ ] Extract the `RelayStore` interface from the in-memory implementation.
- [ ] Add Postgres pool with reconnect and a migration runner.
- [ ] Add the core relational schema.
- [ ] Implement the Postgres-backed store.
- [ ] Enforce prompt idempotency and lease exclusivity in the database.
- [ ] Order events by ingestion sequence rather than device clock.

### Slice 5.2: Retention and storage

- [ ] Add retention pruning for events, prompts, sessions, and audit rows.
- [ ] Add free-tier headroom monitoring against the storage ceiling.
- [ ] Add S3-compatible artifact storage with a local development fallback.
- [ ] Confirm the daily notification cap cannot exhaust the monthly email quota.

### Slice 5.3: Deployment

- [ ] Build a reproducible relay container image.
- [ ] Add deploy and redeploy scripts against the same database.
- [ ] Terminate TLS on the relay host with automated certificate renewal.
- [ ] Add a keepalive job that holds the host above the idle-reclamation threshold.
- [ ] Add scheduled database backups to the artifact bucket with verification.
- [ ] Add a restore path that restores into a branch before promoting.
- [ ] Write the deployment runbook.

## Milestone 6: Connector hub

Plan: `docs/superpowers/plans/2026-10-24-shared-contracts.md` (Task 3) and `docs/superpowers/plans/2026-10-24-connector-hub.md`

### Slice 6.0: Connector contracts

- [ ] Add connector manifest, connection, and event schemas to the shared package.
- [ ] Add the effective risk tier rule to the shared package.

### Slice 6.1: Connector core

- [ ] Add the encrypted credential vault with master key rotation.
- [ ] Add the connector registry with manifest validation.
- [ ] Add the encrypted connection store with lifecycle states.
- [ ] Add the executor with scope check, permission gate, and audit.

### Slice 6.2: Exposure surfaces

- [ ] Add the phone and web REST surface for connect, invoke, and disconnect.
- [ ] Add the MCP endpoint over Streamable HTTP in stateless mode.
- [ ] Serve RFC 9728 protected resource metadata.
- [ ] Register the relay as an MCP server with the local agent.
- [ ] Move the client feed from polling to server-sent events.

### Slice 6.3: First connectors

- [ ] Add the Supabase connector over PostgREST.
- [ ] Add the Gmail connector with a send-first scope strategy.
- [ ] Publish the Google OAuth client to In production to avoid 7-day refresh tokens.
- [ ] Add the connector connection and action events to the feed.
- [ ] Add connector lifecycle notifications to the phone.

## Milestone 7: Multi-agent adapters

Plan: `docs/superpowers/plans/2026-10-24-agent-adapters.md`

### Slice 7.1: Adapter abstraction

- [ ] Extract the `AdamAdapter` interface and capability manifest from the Codex implementation.
- [ ] Add the adapter registry with duplicate and unknown-adapter handling.
- [ ] Move the prompt worker onto the registry with no behaviour change.

### Slice 7.2: OpenCode adapter

- [ ] Detect OpenCode availability and version.
- [ ] Probe `opencode run --help` at runtime for the flags the installed build supports.
- [ ] Start and stop `opencode serve`, and attach runs with `--attach`.
- [ ] Execute prompts over `opencode run --format json` with the prompt on stdin.
- [ ] Normalize the JSON event stream into shared events.
- [ ] Classify tool failures as retryable or terminal.
- [ ] Never pass the permission bypass flag, even when the build offers it.

### Slice 7.3: Permissions and MCP injection

- [ ] Convert OpenCode permission events into shared permission requests.
- [ ] Emit the permission request and wait for the matching decision.
- [ ] Inject the relay MCP endpoint through `OPENCODE_CONFIG_CONTENT`.
- [ ] Confirm the user's `opencode.json` is never modified.

### Slice 7.4: Claude Code and Copilot adapters

- [ ] Add the Claude Code adapter driving `claude -p --output-format stream-json`.
- [ ] Serve the phone's approval decision back to the agent through `--permission-prompt-tool`.
- [ ] Confirm the adapter never uses the permission bypass mode.
- [ ] Add the GitHub Copilot CLI adapter with `--connect` reconnection.
- [ ] Detect and surface the case where Copilot skips MCP because no OAuth handler was present.
- [ ] Add Claude Code JSONL ingestion and the Copilot export as fallbacks.
- [ ] Confirm no adapter reads a private database format.

## Milestone 8: Repository change visibility

- [ ] Add changed-file summary.
- [ ] Add git status sync.
- [ ] Add basic diff viewer.
- [ ] Add task summary artifact.
- [ ] Add log artifact support.
- [ ] Add screenshot artifact support if needed.
- [ ] Validate that mobile can explain current work state without opening the laptop.

## Milestone 9: GitHub delivery visibility

- [ ] Connect GitHub repo metadata.
- [ ] Show current branch.
- [ ] Show PR status.
- [ ] Show GitHub Actions status.
- [ ] Show workflow pass/fail summary.
- [ ] Show merge readiness.
- [ ] Support review comments or links.

## Milestone 10: MVP hardening and alpha release

- [ ] Create setup/install path.
- [ ] Add safe logging.
- [ ] Add reconnect and retry behavior.
- [ ] Add known limitations document.
- [ ] Run security review checklist.
- [ ] Run private alpha onboarding.
- [ ] Collect feedback and update roadmap.

## Post-MVP backlog

- [ ] Claude Code JSONL ingestion.
- [ ] GitHub Copilot official export import.
- [ ] Claude Cowork research spike.
- [ ] Antigravity experimental ingestion review.
- [ ] Cursor permission/legal clarification.
- [ ] Copy-paste fallback importer.
- [ ] Multi-agent dashboard.
- [ ] Repo/project switcher.
- [ ] Contribution graph.
- [ ] Secrets vault/environment profiles.
- [ ] Cloud-hosted execution proof of concept.
- [ ] Team/org policy controls.
- [ ] Billing/usage model.
- [ ] Bring-your-own storage connector proof of concept.
- [ ] Bring-your-own runner/workspace proof of concept.
- [ ] Google Workspace domain-wide delegation connector.
- [ ] Google Calendar and Google Drive capability connectors.
- [ ] GitHub Codespaces or Actions runner research spike.
- [x] Integration surface research for Codex, Claude Code, Copilot, Antigravity, Cursor, and Cowork.

## Checklist update rules

1. Update the current position table whenever the project enters a new milestone or slice.
2. Add newly discovered work to the correct milestone instead of leaving it in chat only.
3. Keep completed items checked; do not delete them during normal progress.
4. Move deferred work to the post-MVP backlog with a short reason in the relevant plan or changelog.
5. Update the changelog in the same commit as meaningful checklist changes.
