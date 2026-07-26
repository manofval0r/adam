# Continuous Checklist

This checklist is the live execution tracker for the project. Update it whenever the active milestone or slice changes. Completed slices should stay checked so the project history remains easy to scan.

## Current position

| Field | Value |
| --- | --- |
| Current phase | Milestone 2: Cloud relay and pairing |
| Current slice | Slice 2.1: Relay skeleton and device model |
| Primary platform | OpenAI Codex CLI |
| Current risk focus | Keep relay/pairing secure and resilient without introducing heavy infrastructure too early |
| Next milestone | Milestone 3: Mobile prompt and activity feed |

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

- [ ] Create relay API skeleton.
- [ ] Add user/device model.
- [ ] Add pairing flow.
- [ ] Add daemon heartbeat.
- [ ] Add client session list.
- [ ] Add encrypted transport assumptions.
- [ ] Add reconnect behavior.
- [ ] Add relay tests.

## Milestone 3: Mobile prompt and activity feed

- [ ] Create mobile/web prompt UI.
- [ ] Create activity feed UI.
- [ ] Sync events from relay to client.
- [ ] Submit prompt from client to relay.
- [ ] Relay prompt from daemon to Codex.
- [ ] Display prompt delivery state.
- [ ] Display failure states.
- [ ] Validate one full phone-to-Codex-to-feed loop.

## Milestone 4: Decision and permission gates

- [ ] Add `decision_request` event.
- [ ] Add `permission_request` event.
- [ ] Add mobile approval/rejection UI.
- [ ] Add shell/system access consent screen.
- [ ] Add audit log for decisions.
- [ ] Add push notification for blocked agent.
- [ ] Prevent dangerous actions without explicit approval.

## Milestone 5: Repository change visibility

- [ ] Add changed-file summary.
- [ ] Add git status sync.
- [ ] Add basic diff viewer.
- [ ] Add task summary artifact.
- [ ] Add log artifact support.
- [ ] Add screenshot artifact support if needed.
- [ ] Validate that mobile can explain current work state without opening the laptop.

## Milestone 6: GitHub delivery visibility

- [ ] Connect GitHub repo metadata.
- [ ] Show current branch.
- [ ] Show PR status.
- [ ] Show GitHub Actions status.
- [ ] Show workflow pass/fail summary.
- [ ] Show merge readiness.
- [ ] Support review comments or links.

## Milestone 7: MVP hardening and alpha release

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
- [ ] GitHub Codespaces or Actions runner research spike.
- [x] Integration surface research for Codex, Claude Code, Copilot, Antigravity, Cursor, and Cowork.

## Checklist update rules

1. Update the current position table whenever the project enters a new milestone or slice.
2. Add newly discovered work to the correct milestone instead of leaving it in chat only.
3. Keep completed items checked; do not delete them during normal progress.
4. Move deferred work to the post-MVP backlog with a short reason in the relevant plan or changelog.
5. Update the changelog in the same commit as meaningful checklist changes.
