# Continuous Checklist

This checklist is the live execution tracker for the project. Update it whenever the active milestone or slice changes. Completed slices should stay checked so the project history remains easy to scan.

## Current position

| Field | Value |
| --- | --- |
| Current phase | Milestone 0: Foundation and planning |
| Current slice | Slice 0.1: Planning documentation |
| Primary platform | OpenAI Codex CLI |
| Current risk focus | Avoid fragile/legally grey integrations before the core relay works |
| Next milestone | Milestone 1: Local daemon prototype |

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
- [ ] Draft legal/safety risk register.

### Slice 0.2: Architecture decisions

- [ ] Choose desktop daemon runtime.
- [ ] Choose mobile app stack.
- [ ] Choose cloud/API stack.
- [ ] Confirm TypeScript monorepo package layout.
- [ ] Confirm shared schema/contract tooling.
- [ ] Confirm Postgres/Supabase versus self-hosted Postgres for first relay.
- [ ] Confirm WebSocket/SSE transport boundaries.
- [ ] Choose storage model for relay state.
- [ ] Define Adam-hosted versus user-owned storage boundaries.
- [ ] Define repo, artifact, and retention limits for free/light usage.
- [ ] Define bring-your-own storage connector requirements.
- [ ] Define bring-your-own runner/workspace connector requirements.
- [ ] Choose local daemon config format.
- [ ] Define local event log format.
- [ ] Define auth and pairing flow at a technical level.

### Slice 0.3: Legal and safety preparation

- [ ] Classify integrations into green/yellow/red risk tiers.
- [ ] Write permission model for shell, file, repo, network, and system access.
- [ ] Write user consent copy for dangerous actions.
- [ ] Write data retention assumptions.
- [ ] List questions for legal review.
- [ ] Mark unsupported/experimental integrations clearly.

## Milestone 1: Local daemon prototype

- [ ] Create daemon package/app skeleton.
- [ ] Add local configuration loading.
- [ ] Detect current repo path.
- [ ] Detect current branch and git status.
- [ ] Detect Codex CLI availability.
- [ ] Detect or resume one Codex session.
- [ ] Emit local `session_started` event.
- [ ] Emit local `activity` events.
- [ ] Write local event log.
- [ ] Add local health command or endpoint.
- [ ] Add basic daemon tests.

## Milestone 2: Cloud relay and pairing

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

## Checklist update rules

1. Update the current position table whenever the project enters a new milestone or slice.
2. Add newly discovered work to the correct milestone instead of leaving it in chat only.
3. Keep completed items checked; do not delete them during normal progress.
4. Move deferred work to the post-MVP backlog with a short reason in the relevant plan or changelog.
5. Update the changelog in the same commit as meaningful checklist changes.
