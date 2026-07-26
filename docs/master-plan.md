# Master Plan: Mobile Remote Control for AI Coding Agents

## Product vision

Adam is a desktop, cloud, web, and mobile platform that lets users supervise and control AI coding agents from anywhere. The first product should let a user continue prompting and monitoring an agent running on their own laptop from a phone. The long-term product should evolve into a cloud-capable command center where local and hosted agents can be managed across repositories, tools, and teams.

The core promise is continuity: a user should be able to leave their desk, keep visibility into what the agent is doing, respond when it needs input, inspect changes, and eventually continue work even when the original laptop is asleep or off.

## Guiding principles

1. Start with the lowest legal-risk and most controllable integration.
2. Build a stable core before adding fragile tool-specific adapters.
3. Treat the mobile app as a remote control, not as a direct IDE client.
4. Use official exports, documented local formats, open-source hooks, or user-mediated copy/paste before undocumented database parsing.
5. Require explicit user consent before granting shell, file-system, repository, or system-level access.
6. Keep advanced controls discoverable, but make the default experience simple: prompt box plus activity feed.
7. Design every integration around a normalized event model so platform support can grow without rewriting the product.
8. Separate execution, source code, session state, and heavy artifacts so users can choose between Adam-hosted convenience and bring-your-own infrastructure.

## Target end product

The mature product is a multi-agent work command center with:

- Mobile, web, and desktop access to active and historical coding-agent sessions.
- A desktop companion daemon that syncs local agent activity while the machine is awake.
- A cloud relay that handles auth, pairing, notification delivery, encrypted transport, and session state.
- Optional cloud-hosted execution for true laptop-off continuity.
- Optional bring-your-own storage and runner integrations for users who want lower platform storage costs or stronger data ownership.
- Adapters for Codex CLI, Claude Code, GitHub Copilot, Claude Cowork, Google Antigravity, Cursor, and future tools.
- Plain-language agent activity feeds.
- Prompt, pause, resume, and continue controls.
- Decision-point notifications when an agent needs input.
- Diff viewing and approval workflows.
- Pull request, CI, deployment, and repository health visibility.
- Artifact views for plans, screenshots, logs, summaries, and generated outputs.
- Multi-agent dashboards for supervising parallel work.
- Contribution graph and audit history for AI-assisted changes.
- Team/org policy controls for access, permissions, data retention, and compliance.

## System architecture

```text
Mobile App / Web App
        |
Cloud Relay and API
        |-------------------- User-owned storage / runner connectors
        |
Desktop Companion Daemon
        |
Adapter Layer
        |
Codex CLI / Claude Code / GitHub Copilot / Claude Cowork / Antigravity / Cursor
```

### Component responsibilities

| Component | Responsibility |
| --- | --- |
| Mobile app | Remote prompt box, activity feed, notifications, approvals, diffs, PR/CI visibility, multi-agent views. |
| Web app | Same control surface as mobile, optimized for larger screens and team workflows. |
| Cloud relay | Pairing, authentication, session sync, notification delivery, encrypted relay, cloud state, billing/account model. |
| Desktop daemon | Local agent discovery, local session sync, command relay, permission prompts, local environment access while the machine is awake. |
| IDE extensions | Official exports and IDE-specific context where supported. They should not be the only sync mechanism because they stop running when the IDE closes. |
| Adapter layer | Tool-specific ingestion/control implementation mapped into a common event schema. |
| User-owned storage connectors | Optional connectors for Supabase, MongoDB, S3/R2, Cloudinary, or similar services to store session history, artifacts, logs, screenshots, and large generated outputs under the user's account. |
| User-owned runner connectors | Optional connectors for GitHub Codespaces, GitHub Actions self-hosted runners, cloud VMs, or user-managed containers where the agent can run without Adam owning the workspace storage. |
| Cloud execution layer | Hosted workspaces/runners for true laptop-off operation. This is a later, higher-risk milestone and should use ephemeral workspaces with clear limits. |

## Execution and storage strategy

The laptop-off goal needs both a place to store project state and a place to execute the agent. Linking a user's private database or file store can reduce Adam's storage burden, but it does not replace the need for compute, a filesystem workspace, git credentials, dependency caches, secrets, and sandboxing.

### Storage model options

| Model | How it works | Best for | Tradeoffs |
| --- | --- | --- | --- |
| Adam-hosted light storage | Adam stores session state, small artifacts, summaries, and limited repo/workspace metadata. | Free or low-cost users, small repos, early MVP simplicity. | Adam carries storage cost and must enforce size/retention limits. |
| Adam-hosted premium workspace | Adam provides managed cloud workspace storage and execution. | Users who want the simplest laptop-off experience. | Highest cost and highest security/compliance responsibility. |
| Bring-your-own database | User links Supabase, MongoDB, Firebase, Postgres, or similar for events, session metadata, and audit logs. | Users who want data ownership or lower platform storage cost. | More setup friction, provider-specific failures, schema migration complexity. |
| Bring-your-own object storage | User links S3, R2, Supabase Storage, Cloudinary, or similar for logs, screenshots, generated files, and large artifacts. | Heavy artifacts and long histories. | Still requires Adam or another runner to execute code; egress and permissions need clear UX. |
| Bring-your-own runner/workspace | User connects GitHub Codespaces, Actions runners, cloud VMs, containers, or their own server. | True laptop-off work without Adam hosting every workspace. | Harder onboarding, runner health issues, security boundaries vary by provider. |
| GitHub-native source of truth | GitHub remains the canonical repo store; Adam stores only branches, commits, PR metadata, events, and artifacts. | Most code workflows. | Does not solve dependency caches or live execution by itself. |

### Recommendation

Use a tiered model instead of replacing Adam-hosted storage entirely:

1. Keep the MVP local-first with Adam relay state only.
2. Add strict Adam-hosted limits for light cloud state: repo metadata, events, summaries, small artifacts, and short retention.
3. Make heavy artifacts and long history eligible for bring-your-own storage.
4. Make true laptop-off coding a premium or bring-your-own-runner feature, because execution cost is the expensive part, not just repo storage.
5. Treat user-owned databases as an advanced connector, not the default onboarding path.

This keeps the first-run experience simple while giving cost-sensitive or privacy-sensitive developers a path that does not require Adam to host everything.

## Recommended technology stack

Adam should optimize for fast product iteration, shared types across clients and services, and a clean path from local-first MVP to hosted execution. The recommended default is a TypeScript-first monorepo, with stronger isolated runtime technology introduced only where execution security demands it.

### MVP stack

| Layer | Recommended choice | Why |
| --- | --- | --- |
| Monorepo | TypeScript, pnpm, Turborepo | Shared types, faster iteration, one repo for daemon, API, web, mobile, and shared packages. |
| Shared contracts | Zod schemas plus OpenAPI or tRPC-style internal contracts | Keeps normalized events, permissions, and adapter payloads consistent across daemon, relay, web, and mobile. |
| Desktop daemon | Node.js TypeScript daemon packaged as a CLI/service | Best early fit for spawning Codex CLI, reading git status, writing local logs, and sharing code with the relay. |
| Local daemon storage | SQLite | Simple durable local event log, offline queue, config cache, and retry state. |
| Cloud relay/API | Node.js TypeScript with Fastify or NestJS | Good WebSocket/SSE support, strong ecosystem, easy schema sharing with clients. Fastify is leaner; NestJS is heavier but structured. |
| Primary cloud database | Postgres, ideally Supabase for early builds | Relational session, device, user, audit, and event metadata are a better fit than document-only storage. Supabase also gives auth/storage options if useful. |
| Realtime transport | WebSockets for daemon relay, SSE or WebSockets for clients | The daemon needs bidirectional control; mobile/web mostly need live feed updates and prompt status. |
| Queue/background jobs | BullMQ with Redis or a managed queue | Handles prompt delivery retries, notifications, sync jobs, artifact processing, and webhook fanout. |
| Web app | Next.js with React | Strong dashboard/product surface, auth flows, billing/admin screens, and shared UI with the mobile stack where practical. |
| Mobile app | Expo React Native | Fastest path to iOS/Android, push notifications, camera/files later, and shared TypeScript models. |
| Push notifications | Expo Notifications for MVP, later direct APNS/FCM if needed | Reduces setup complexity while validating decision-point notifications. |
| GitHub integration | GitHub App plus GitHub REST/GraphQL APIs | Clean user/repo authorization, PR/CI visibility, branch metadata, and later managed execution hooks. |
| Object/artifact storage | Supabase Storage or S3-compatible storage | Good for logs, screenshots, summaries, and large artifacts; keep strict limits on the free/light tier. |
| Observability | Sentry plus structured logs | Captures daemon/API/mobile failures without building custom tooling too early. |
| Billing | Stripe | Standard for premium hosted execution, storage limits, and team plans. |

### Later cloud-execution stack

| Need | Recommended direction | Notes |
| --- | --- | --- |
| Managed hosted workspaces | Containerized ephemeral workspaces | Clone repo per task/session, run agent in a disposable workspace, persist only branch/commit/artifacts. |
| Strong sandboxing | Firecracker, gVisor, or a managed sandbox provider | Required before running untrusted project commands at scale. Do not build this too early. |
| User-owned runners | GitHub Codespaces, GitHub Actions self-hosted runners, generic SSH/VM/container connectors | Better cost model for advanced users; Adam coordinates rather than owns all compute/storage. |
| Secrets | Encrypted secrets vault with short-lived injection into runners | Needed for cloud execution, but keep out of MVP unless absolutely required. |
| Heavy artifact storage | Bring-your-own S3/R2/Supabase Storage/Cloudinary | Good premium-adjacent feature for long logs, videos, screenshots, generated reports, and large histories. |

### Stack decisions to avoid early

- Do not start with Kubernetes unless hosted execution is already the active milestone; it adds operational weight before the relay loop is proven.
- Do not make MongoDB the primary system database; event feeds can look document-like, but auth, devices, repos, sessions, permissions, billing, and audit logs benefit from relational constraints.
- Do not make bring-your-own storage mandatory; it will slow onboarding and support. Keep it optional for advanced/premium users.
- Do not build a full browser IDE for the MVP; the first product should be remote prompt, activity, approvals, diffs, and GitHub delivery visibility.

## Normalized event model

Every supported tool should map into a common set of event types:

| Event | Meaning |
| --- | --- |
| `session_started` | Agent session was created, resumed, or detected. |
| `message` | User or assistant text message. |
| `activity` | Plain-language status update about what the agent is doing. |
| `tool_call` | Agent invoked a tool or command. |
| `permission_request` | Agent needs user consent for shell, file, network, repo, or system access. |
| `permission_decision` | User approved, rejected, or allowed a permission request to expire. |
| `decision_request` | Agent needs product, design, or implementation guidance. |
| `decision_response` | User answered a decision request. |
| `file_change` | File was created, edited, deleted, or renamed. |
| `diff` | Renderable code diff for review. |
| `artifact` | Plan, summary, screenshot, log, report, generated document, or other output. |
| `git_event` | Branch, commit, status, push, PR, review, or merge event. |
| `ci_event` | Workflow, build, test, deployment, or health-check event. |
| `prompt_delivery` | Remote prompt delivery state across client, relay, daemon, and adapter. |
| `error` | Adapter, relay, permission, sync, or agent execution failure. |
| `session_ended` | Session completed, was stopped, failed, or went idle. |

See [Normalized Event Schema](event-schema.md) for implementation-ready envelope, payload, delivery, and retention details. See [Adapter Contract](adapter-contract.md) for the integration boundary between Adam and coding-agent tools.

## Platform strategy

| Platform | Priority | Strategy | Risk |
| --- | ---: | --- | --- |
| OpenAI Codex CLI | 1 | First integration. Use official resume/session behavior and CLI wrapping where appropriate. | Low |
| Claude Code | 2 | Strong ingestion via JSONL transcripts at `~/.claude/projects/<project>/<session-id>.jsonl`; control only through safe/official mechanisms. | Low to medium |
| GitHub Copilot | 3 | Prefer official `Chat: Export Session`; avoid raw `state.vscdb` parsing in the MVP. | Medium |
| Claude Cowork | 4 | Research ingestion/control surfaces before committing to support. | Unknown |
| Google Antigravity | 5 | Experimental ingestion only until format stability and legal posture are clear. | Medium to high |
| Cursor | 6 | Opt-in/unofficial only until Cursor grants permission or clarifies acceptable local history access. | High |

## Legal and safety model

### Integration tiers

| Tier | Definition | Examples | Product stance |
| --- | --- | --- | --- |
| Green | Official export/API, documented local format, open-source mechanism, or user-mediated import. | Codex CLI, Claude Code JSONL, Copilot export. | Safe for MVP. |
| Yellow | Undocumented local files/databases with no server scraping or rate-limit bypass. | Antigravity SQLite/protobuf, Copilot local DB. | Experimental after legal review. |
| Red | Reverse engineering, hidden service calls, bypassing APIs, automated bulk activity, or prohibited access. | Cursor internals without permission, service scraping. | Do not ship. |

### Permissions

- Shell, PowerShell, file-system, repo, network, and system-level access must be explicit and user-approved.
- The app should show a Codex-style consent screen before granting a tool elevated capabilities.
- System access should be a separate permissions module, not mixed into ingestion.
- Logs and audit trails should record permission requests and user decisions.
- The app should behave as a gateway/conduit between the user and their already-authorized agents, but this positioning must be reviewed by a lawyer before launch.

## Feature roadmap

### Layer 1: Default experience

- Prompt box.
- Plain-language activity feed.
- Current session status.
- Push notifications for decision points.
- Basic changed-file summary.
- Device pairing and auth.

### Layer 2: Practical delivery controls

- Diff viewer.
- Approve/reject next step.
- Pull request visibility.
- CI/health check status.
- Artifact cards for plans, logs, screenshots, summaries, and reports.
- GitHub workflow status.
- Branch and commit tracking.
- Copy-paste fallback import for unsupported tools.

### Layer 3: Power-user and team controls

- Multi-agent manager.
- Repo/project switcher.
- Contribution graph for AI-assisted pushes and commits.
- Policy controls for teams.
- Role-based access.
- Audit logs and retention policies.
- Secrets vault and environment profiles.
- Cloud-hosted execution.
- Bring-your-own storage connectors.
- Bring-your-own runner/workspace connectors.
- Billing and usage limits.

## Long-term milestones

| Milestone | Goal | Outcome |
| --- | --- | --- |
| 0. Product foundation | Define product, schema, safety, and docs. | Shared direction and implementation checklist. |
| 1. Codex Remote Control Alpha | Prove phone-to-local-agent loop. | Phone can view and prompt one Codex session through daemon and relay. |
| 2. Ingestion SDK | Normalize histories and tool activity. | Adapter contract supports Codex and Claude Code ingestion. |
| 3. Agent control loop | Make remote supervision useful. | Prompt/resume, decision requests, permission gates, notifications. |
| 4. Code review layer | Review work from phone. | Diffs, changed files, approval/rejection, summaries. |
| 5. GitHub delivery integration | Connect work to PRs and CI. | PR status, Actions status, review comments, merge readiness. |
| 6. Safe multi-tool expansion | Add supported platforms in risk order. | Copilot export, Claude Cowork research, experimental Antigravity/Cursor if cleared. |
| 7. Cloud execution | Remove laptop dependency. | Hosted or user-owned runners/workspaces with secure secrets, repo access, and clear storage limits. |
| 8. Command center | Support power users and teams. | Multi-agent dashboard, org policy, audit, billing, contribution graph. |

## Open questions

- Should the mobile app allow switching repos/agents immediately, or stay locked to one active project during MVP?
- What is the safest command-injection mechanism for Codex CLI control?
- What parts of Claude Code are safe to control remotely versus ingestion-only?
- What is Claude Cowork's official or practical ingestion surface?
- What legal wording is needed for gateway/conduit liability?
- What data must be encrypted end-to-end versus encrypted at rest/in transit only?
- What is the minimum cloud execution model that is useful without becoming a full IDE hosting platform?
- Which data belongs in Adam-hosted storage, user-owned databases, user-owned object storage, GitHub, or ephemeral runner disks?
- Which bring-your-own runner targets should be supported first: GitHub Codespaces, GitHub Actions self-hosted runners, cloud VMs, or generic containers?
