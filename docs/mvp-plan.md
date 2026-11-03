# MVP Plan: Codex Remote Control Alpha

## MVP objective

Build the first usable version of Adam around OpenAI Codex CLI because it has the best combination of legal safety, control surface, and implementation practicality. The MVP should prove that a user can monitor and prompt a local coding agent from a phone, with enough session state, notifications, and repository visibility to make remote supervision genuinely useful.

## MVP scope

### In scope

- Desktop companion daemon.
- Cloud relay/API.
- Mobile prompt box.
- Mobile activity feed.
- Device pairing and authenticated relay.
- One active Codex CLI session.
- Session detection/resume.
- Prompt forwarding.
- Activity/event ingestion.
- Changed-file summary.
- Basic permission prompts.
- Push notification for decision points.
- Documentation and changelog process.

### Out of scope for MVP

- Cursor raw database parsing.
- Antigravity raw database parsing.
- Full GitHub Copilot local history parsing.
- Cloud-hosted execution.
- Bring-your-own storage or runner connectors.
- Multi-agent dashboard.
- Team/org administration.
- Billing.
- Full secrets vault.

## Recommended MVP tech stack

| Area | Choice |
| --- | --- |
| Repo structure | TypeScript monorepo with pnpm and Turborepo. |
| Shared contracts | Zod schemas for normalized events, permissions, devices, sessions, and prompt delivery states. |
| Desktop daemon | Node.js TypeScript CLI/service with JSONL local event log in Milestone 1, with SQLite as the next upgrade path for richer queue/query behavior. |
| Cloud relay/API | Node.js TypeScript using Fastify by default; consider NestJS only if the service grows into many modules quickly. |
| Cloud database | Postgres, with Supabase as the easiest early managed option. |
| Realtime | WebSockets between daemon and relay; SSE or WebSockets between relay and web/mobile clients. |
| Web app | Next.js and React. |
| Mobile app | Expo React Native. |
| Queue/jobs | Redis-backed queue such as BullMQ, or a managed queue if hosting provider makes that easier. |
| Notifications | Expo Notifications first; direct APNS/FCM later if needed. |
| GitHub | GitHub App for repo authorization, PR metadata, Actions status, and future runner/workspace integrations. |
| Artifact storage | Supabase Storage or S3-compatible storage with small free-tier limits. |

This stack keeps the MVP simple because the daemon, relay, web app, mobile app, and shared event model can use the same language and schema definitions. Heavier infrastructure such as Kubernetes, managed sandboxes, user-owned runners, and premium hosted workspaces should wait until the local remote-control loop is proven.

## MVP milestone map

### Milestone 0: Foundation and planning

Goal: Create enough product, architecture, safety, and execution documentation for implementation to move in clear slices.

Deliverables:

- Master plan.
- MVP plan.
- Continuous checklist.
- Changelog process.
- Initial normalized event schema draft.
- Initial adapter contract draft.
- Architecture decisions.
- Legal/safety risk register.

Definition of done:

- Repo contains planning docs.
- MVP scope is explicit.
- Platform priority order is explicit.
- Event schema and adapter contract are documented enough to begin implementation.
- Architecture, safety, and free-MVP constraints are explicit.
- GitHub Actions health checks are configured for documentation quality.
- Current work slice is visible in the checklist.

### Milestone 1: Local daemon prototype

Goal: Run a desktop companion process that can detect a local project and one Codex session.

Deliverables:

- Daemon process skeleton.
- Local config file.
- Project/repo detection.
- Codex availability detection.
- Session discovery/resume proof.
- Local event log.

Definition of done:

- Daemon starts locally.
- Daemon can report repo path, branch, and Codex availability.
- Daemon can identify or resume one Codex session.
- No cloud dependency required yet.

### Milestone 2: Cloud relay and pairing

Goal: Securely connect one phone/web client to one desktop daemon.

Deliverables:

- Relay API.
- Device pairing flow.
- Auth token model.
- Encrypted transport.
- Daemon heartbeat.
- Client session list endpoint.

Definition of done:

- A paired client can see that the desktop daemon is online.
- The relay can show one active session.
- The daemon can disconnect/reconnect safely.

### Milestone 3: Mobile prompt and activity feed

Goal: Let the user view session activity and send a prompt from mobile.

Deliverables:

- Mobile prompt box.
- Activity feed.
- Message/event sync.
- Prompt submission endpoint.
- Daemon-side prompt relay into Codex.
- Error states for offline daemon, stopped session, or failed prompt delivery.
- Session-level consent that remote prompts may trigger agent-side file, shell, network, or repo actions.
- Local/dev-only labeling until blocked tool approval states are surfaced safely.

Definition of done:

- User can send a prompt from phone/web to the local Codex session.
- Resulting activity appears in the feed.
- Failures are visible and actionable.
- Prompt forwarding is not presented as safe for alpha users until minimum consent, audit, and blocked-state visibility exist.

### Milestone 4: Decision and permission gates

Goal: Make remote control safe enough for real work.

Deliverables:

- A shared `packages/contracts` package owning the event envelope and the permission vocabulary, pulled forward from the platform milestone because this milestone depends on it.
- Permission request event type.
- Decision request event type.
- Mobile approval/rejection UI.
- Consent screen for shell/system-level access.
- Audit log for approvals.
- Notification trigger when input is required.
- Remote surfacing for underlying agent approval/tool-blocked states.

Definition of done:

- Agent can ask for user approval.
- User can approve/reject from phone.
- Permission decisions are recorded.
- Dangerous actions are not silently allowed.
- The event and permission types are defined once, in the shared package, and both apps consume them.

### Milestone 5: Durable platform

Goal: Make the relay runnable unattended on infrastructure that can disappear at any moment.

Deliverables:

- Postgres-backed relay state with migrations, prompt idempotency, and lease exclusivity enforced in the database.
- Retention pruning and free-tier headroom monitoring.
- S3-compatible artifact storage with a local development fallback.
- A reproducible container build, deploy and redeploy scripts, TLS termination, and a keepalive job.
- Scheduled backups with a restore path that restores into a branch before promoting.

Definition of done:

- The relay survives losing its host with no data loss.
- Two relay instances can run at once without double-delivering a prompt.
- A bad migration can be rolled back from the branch history.
- A daily job reports how close the free-tier ceilings are.

### Milestone 6: Connector hub

Goal: Let the user connect an external account once and use it from both the phone and the agent.

Deliverables:

- Connector manifest, connection, and event schemas added to the shared contracts package.
- An encrypted credential vault with envelope encryption and master key rotation.
- A connector registry, connection store with lifecycle states, and an executor that applies the scope check, permission gate, and audit.
- A REST surface for the phone and web client, and an MCP endpoint over Streamable HTTP for the agent.
- The first connectors: Supabase over PostgREST, and Gmail with a send-first scope strategy.
- Connector connection and action events in the feed, with lifecycle notifications to the phone.

Definition of done:

- A user can connect one account and use it from the phone and from the agent.
- The agent never holds a provider credential.
- An action outside the granted scope is refused, audited, and never reaches the provider.
- A revoked grant blocks further use instead of retrying silently.

### Milestone 7: Multi-agent adapters

Goal: Support more than one coding agent without duplicating the daemon, and let the connector hub reach the agent.

Deliverables:

- A shared adapter interface and capability manifest, extracted from the existing Codex implementation.
- An OpenCode adapter in server-backed mode, using `opencode serve` with `--attach` so the MCP connection to the connector hub stays open between prompts.
- OpenCode capability detection, runtime flag probing, prompt execution over `opencode run --format json`, and event normalization.
- A Claude Code adapter that uses `--permission-prompt-tool` to serve the phone's approval decision back to the agent.
- A GitHub Copilot CLI adapter that reconnects to a running session with `--connect` and streams structured JSONL.
- Permission forwarding that surfaces the tool's own approval request on the phone rather than bypassing it.
- MCP injection through `OPENCODE_CONFIG_CONTENT`, so the user's own config is never modified.
- Claude Code JSONL transcript ingestion and the Copilot session export as fallbacks for sessions Adam did not drive.

Definition of done:

- A user with OpenCode installed can drive it from the phone.
- The connector hub's tools are reachable from the OpenCode agent.
- An approval request raised by OpenCode appears on the phone and the agent waits.
- Adding a further agent requires a new adapter, not changes to the daemon core.

### Milestone 8: Repository change visibility

Goal: Let the user understand what the agent changed without opening the laptop.

Deliverables:

- Changed-file summary.
- Git status integration.
- Basic diff viewer.
- Generated task summary artifact.
- Optional screenshot/log artifact support.

Definition of done:

- Mobile UI shows changed files.
- User can inspect a readable diff.
- User can understand the current state of the work from the feed plus summary.

### Milestone 9: GitHub delivery visibility

Goal: Connect local agent work to pull requests and CI.

Deliverables:

- GitHub repo connection.
- PR status view.
- GitHub Actions status.
- Workflow pass/fail summary.
- Branch/commit tracking.
- Merge readiness signal.

Definition of done:

- User can see whether the branch has a PR.
- User can see CI status from mobile.
- User can tell whether the work is likely safe to review or merge.

### Milestone 10: MVP hardening and alpha release

Goal: Make the Codex alpha reliable enough for private testing.

Deliverables:

- Installer or documented local setup.
- Basic telemetry/logging that excludes secrets.
- Retry/backoff behavior.
- Offline/reconnect behavior.
- Security review checklist.
- Alpha user onboarding.
- Known limitations page.

Definition of done:

- A tester can install, pair, run, prompt, review changes, and recover from common failures.
- Unsupported tools are clearly labeled as future work.

## Post-MVP expansion order

1. Claude Code ingestion via JSONL.
2. GitHub Copilot official export import.
3. Claude Cowork research spike.
4. Antigravity experimental local ingestion if cleared.
5. Cursor experimental adapter only after permission/legal clarity.
6. Cloud-hosted execution proof of concept.
7. Bring-your-own runner and workspace connectors.
8. Multi-agent command center.

## MVP feature backlog

| Feature | MVP? | Notes |
| --- | --- | --- |
| Phone prompt box | Yes | Core control surface. |
| Activity feed | Yes | Default view. |
| Device pairing | Yes | Required for safety. |
| Desktop daemon | Yes | Required for local sync/control. |
| Cloud relay | Yes | Required for mobile access. |
| Codex session resume | Yes | First adapter target. |
| OpenCode session resume | Yes | Second adapter target, server-backed mode. |
| Push notifications | Yes | Needed for decision points. |
| Permission gates | Yes | Safety-critical. |
| Changed-file summary | Yes | Minimum repository visibility. |
| Diff viewer | Yes | Target Milestone 8. |
| PR status | Soon | Milestone 9. |
| CI status | Soon | Milestone 9. |
| Artifact cards | Soon | Start with summaries/logs. |
| Copy-paste fallback | Soon | Useful for unsupported tools. |
| Multi-agent dashboard | Later | Post-MVP. |
| Repo switcher | Later | Post-MVP unless required by testers. |
| Contribution graph | Later | Power-user feature. |
| Cloud execution | Later | Hardest/riskier milestone. |
| Bring-your-own storage | Later | Capability and storage connectors land in Milestone 6. A user-owned bucket as the storage target remains later. |
| Bring-your-own runner | Later | Better fit for laptop-off coding than database-only storage. |
| Team/org policy controls | Later | Requires stable core first. |

## Recommended first implementation slice

Start with Milestone 1, Slice 1.1:

1. Choose daemon runtime and repo layout.
2. Define local daemon config.
3. Implement repo detection.
4. Implement Codex CLI availability check.
5. Write a local event log format that already resembles the normalized event model.

This slice creates useful implementation momentum without committing to cloud infrastructure too early.
