# Legal and Safety Risk Register

This register identifies the major legal, product safety, privacy, and operational risks for Adam's MVP and long-term platform. It is not legal advice; it is an engineering and product planning artifact that should be reviewed by counsel before public launch.

## Risk policy

1. Prefer official APIs, documented formats, open-source hooks, and user-mediated exports.
2. Avoid reverse engineering, service scraping, hidden API calls, or bypassing provider limits.
3. Treat Adam as a user-directed gateway to tools the user is already authorized to use.
4. Require explicit consent before shell, filesystem, repository, network, system, or secrets access.
5. Store the minimum data needed for sync, audit, and recovery.
6. Make unsupported integrations visibly unsupported instead of quietly experimental.

## Integration risk tiers

| Tier | Definition | Examples | MVP stance |
| --- | --- | --- | --- |
| Green | Official CLI/API/export, documented local format, open-source mechanism, or user-mediated import. | Codex CLI, OpenCode, Claude Code JSONL ingestion, GitHub APIs, GitHub Copilot chat export. | Allowed if permission model is respected. |
| Yellow | Undocumented local files or unstable local formats without service scraping or API bypass. | Antigravity local SQLite/protobuf if user-selected, Copilot local DB research. | Research only until legal/product review approves. |
| Red | Reverse engineering, hidden service calls, scraping, bypassing APIs, automating prohibited activity, or uncontrolled mutation. | Cursor internals without permission, private service endpoints, terms-bypass automation. | Do not ship. |

## Risk register

| Risk | Severity | Likelihood | Mitigation | Owner before launch |
| --- | --- | --- | --- | --- |
| Tool terms violation | High | Medium | Use green-tier integrations first; keep yellow/red out of MVP; get legal review before launch. | Founder/legal |
| Remote shell misuse | High | Medium | No direct mobile shell in MVP; require permission requests with command preview and audit log. | Engineering |
| Unintended file/repo mutation | High | Medium | Agent/tool owns edits; Adam only relays prompts; repo mutations require explicit scope and future permission gates. | Engineering |
| Secrets exposure | High | Medium | Do not read `.env`, credentials, SSH keys, or secret stores in MVP; never store secrets in logs/events. | Engineering |
| User data over-collection | High | Medium | Store event summaries and artifact pointers; cap retention; avoid full file contents unless required and approved. | Product/engineering |
| Misleading laptop-off claims | Medium | High | Clearly state MVP requires laptop awake; cloud execution is later/premium/BYO runner. | Product |
| Fragile adapter behavior | Medium | High | Capability manifests, health checks, graceful degraded states, and import-only modes where control is unsafe. | Engineering |
| BYO storage credential risk | High | Medium | Post-MVP only; least-privilege tokens; provider-specific setup docs; revocation path. | Engineering |
| GitHub authorization overreach | High | Medium | Use GitHub App permissions narrowly; request repo access only as needed. | Engineering |
| Audit gaps | Medium | Medium | Record permission and decision events with audit retention. | Engineering |
| Cloud runner sandbox escape | Critical | Low for MVP | Hosted execution is out of MVP; require sandbox architecture review before enabling. | Engineering/security |
| Cost blowup | Medium | Medium | Free-tier caps, small artifacts, short retention, no hosted execution in MVP. | Product/engineering |

## Permission model

| Capability | MVP default | Required user consent |
| --- | --- | --- |
| View session activity | Allowed after device pairing. | Pairing approval. |
| Send prompt to active session | Allowed only after device pairing and session-level consent that remote prompts may trigger agent-side file, shell, network, or repo actions. Pre-gate prompt forwarding is local/dev-only. | Pairing approval plus session-level remote-control consent. |
| Read repo path, branch, and status | Allowed for paired project. | Pairing approval. |
| Read file contents | Blocked by default. | Filesystem permission with path preview. |
| Write files directly | Blocked by default. | Filesystem/repo permission; avoid in MVP. |
| Run shell/PowerShell | Blocked by default. | Shell permission with command preview, risk label, and timeout. |
| Network access beyond relay/tool defaults | Blocked by default. | Network permission with destination/category. |
| Read secrets/env files | Blocked. | Not supported in MVP. |
| Push branches or mutate PRs | Blocked in MVP. | Future repo permission with GitHub scope preview. |
| Start cloud runner | Out of scope. | Future premium/BYO runner consent and secrets review. |

Milestone 3 prompt forwarding must not be treated as a user-safe alpha release until Adam can surface blocked tool/approval states from the underlying agent. Full first-class permission gates arrive in Milestone 4, but the pre-gate implementation must still include session-level consent, audit events, and clear local/dev-only labeling.

## Consent copy templates

### Shell/system access

> Adam needs your approval before allowing the agent to run this command. Review the command and only approve it if you understand the effect. This may change files, install packages, access the network, or expose local environment details.

### File access

> Adam needs your approval before exposing these files to the agent or remote client. Only approve paths that are part of the project and do not contain secrets or private data.

### Repository mutation

> Adam needs your approval before changing repository state. This action may create commits, push branches, open pull requests, or update existing GitHub resources.

### Cloud execution

> Adam needs your approval before starting a cloud runner. The runner may clone your repository, install dependencies, execute project code, and use configured secrets. Only continue if you trust the repository and runner configuration.

## Data retention assumptions

| Data | MVP retention |
| --- | --- |
| Local SQLite event log | Retain until user clears project state. |
| Relay session events | Short retention for free alpha; exact TTL to be decided before deployment. |
| Permission decisions | Audit retention; longer than normal events. |
| Prompt text | Store only as needed for session continuity and replay. |
| Large artifacts | Avoid in MVP or store with strict size limits. |
| Secrets | Do not store. |
| Raw terminal logs | Avoid by default; store summaries or capped artifacts. |

## Unsupported and experimental integrations

| Integration | Status | User-facing label |
| --- | --- | --- |
| Codex CLI | MVP target | Supported alpha integration. |
| OpenCode | MVP target, second adapter | Supported alpha integration. |
| Claude Code JSONL | Post-MVP | Planned ingestion integration. |
| GitHub Copilot export | Post-MVP | Planned import integration. |
| Claude Cowork | Research | Research only. |
| Google Antigravity local parsing | Experimental | Not supported; may change or be removed. |
| Cursor internals | Red-risk | Not supported. |

## Legal review questions

1. Is Adam's gateway/conduit positioning acceptable for relaying user prompts to locally authorized coding agents?
2. What consent language is required before remote shell, file, repo, network, system, or cloud-runner access?
3. What data retention and deletion controls are required for prompt text, event history, artifacts, and audit logs?
4. Which integrations are safe under provider terms: Codex CLI, OpenCode, Claude Code JSONL, Copilot export, Antigravity local files, Cursor local files?
5. What disclaimers are required for alpha users whose agents may modify code, run commands, or create pull requests?
6. What security controls are required before Adam hosts cloud execution?
7. What terms should govern user-owned storage and runner connectors?

## Launch gates

- Legal review completed for MVP integrations and consent language.
- Unsupported integrations are clearly labeled.
- Permission requests and decisions are auditable.
- Secrets are excluded from logs and event payloads.
- Free-tier retention and artifact limits are configured.
- Cloud execution remains disabled until sandbox and secrets handling are reviewed.
