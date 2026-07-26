# Architecture Decisions

This document records the Milestone 0 technical decisions for Adam's free/low-cost MVP. The goal is to prove feasibility before taking on expensive hosted execution, heavy storage, mobile app-store distribution, or multi-agent complexity.

## Decision summary

| Area | Decision | Rationale |
| --- | --- | --- |
| MVP shape | Local-first remote control loop | Proves the core product without paying for hosted workspaces. |
| Primary integration | Codex CLI local adapter | Lowest-risk first control surface and aligns with the current product direction. |
| Repo structure | TypeScript monorepo with `apps/*` and `packages/*` | Shared types and schemas across daemon, relay, web, and future mobile. |
| Package manager | npm workspaces (M1), pnpm optional later | Zero-friction setup for feasibility; no extra tooling required to start coding and running CI. |
| Build orchestration | Turborepo later, not required on day one | Useful once there are multiple packages; avoid unnecessary setup before the first daemon/API packages exist. |
| Desktop daemon runtime | Node.js TypeScript CLI/service | Best early fit for spawning CLI tools, inspecting git, writing local logs, and sharing event schemas. |
| Local event storage | JSONL append log for Milestone 1; SQLite upgrade path | Keeps Milestone 1 dependency-free while preserving normalized events. SQLite can be added for richer querying and cursor durability. |
| Cloud relay/API | Node.js TypeScript with Fastify | Lean HTTP/WebSocket API with good TypeScript ergonomics and fewer framework constraints than NestJS. |
| Cloud database | Postgres, with Supabase as the first managed candidate | Free tier is enough for feasibility; relational constraints fit users/devices/sessions/events/audit better than MongoDB. |
| Web client | Next.js responsive web/PWA first | Faster and cheaper than shipping native mobile first; still usable from mobile browsers. |
| Native mobile | Expo React Native after web loop works | Keep push/mobile-specific work for the point where the core loop is proven. |
| Realtime transport | WebSocket daemon-to-relay; SSE or WebSocket relay-to-client | The daemon needs bidirectional control; clients mostly need live feed updates plus prompt status. |
| Artifact storage | Adam-hosted small artifacts first; S3-compatible/BYO later | Keep MVP storage limited and cheap. Heavy artifacts belong in premium or user-owned storage. |
| GitHub integration | GitHub App | Cleaner long-term repo auth, PR metadata, CI status, and future runner/workspace integration. |
| CI health checks | Dependency-free docs checks now; package tests later | Gives immediate quality gates without adding dependency cost or toolchain weight. |

## MVP architecture

```text
Responsive Web/PWA
        |
Cloud Relay/API
        |
Desktop Daemon
        |
Codex CLI Adapter
        |
Local Git Repo
```

The MVP should not attempt true laptop-off execution. It should prove that a user can pair a device, see one local coding-agent session, send a prompt remotely, and receive activity back while the laptop is awake.

## TypeScript monorepo layout

Use this structure when implementation starts:

```text
apps/
  daemon/
  relay/
  web/
packages/
  events/
  adapters/
  config/
  git/
  shared/
docs/
scripts/
.github/workflows/
```

| Package/app | Purpose |
| --- | --- |
| `apps/daemon` | Local process that detects repos/tools, persists local events, and connects to the relay. |
| `apps/relay` | Auth, pairing, WebSocket/SSE transport, event sync, prompt delivery, and GitHub webhooks. |
| `apps/web` | Mobile-friendly web/PWA control surface. |
| `packages/events` | Zod schemas and TypeScript types for normalized events. |
| `packages/adapters` | Adapter interface and shared adapter helpers. |
| `packages/config` | Config parsing, defaults, and environment validation. |
| `packages/git` | Shared git status and diff helpers. |
| `packages/shared` | Cross-cutting utilities that do not belong to a narrower package. |

## Local daemon decisions

| Topic | Decision |
| --- | --- |
| Runtime | Node.js TypeScript. |
| Distribution for alpha | CLI first; background service/installers later. |
| Config file | `.adam/config.json` may exist in the project only for non-secret project preferences; user/device secrets belong outside the repo. |
| Local state path | OS app-data directory by default; `.adam/state/` may be used only for local alpha/dev state and must stay gitignored. |
| Event log | Append-only JSONL (`.adam/state/events.jsonl`) for Milestone 1 prototype; migrate to SQLite when relay buffering/query needs increase. |
| Health command | `adam daemon health` should report repo path, branch, git status availability, Codex availability, relay pairing state, and queue depth. |
| Safety default | No direct remote shell. Dangerous actions require permission events. |

The repository includes a `.gitignore` boundary for `.adam/state/`, local SQLite databases, token-like files, and environment files. Runtime state, prompt history, adapter cursors, and device tokens must not be committed.

### Local SQLite upgrade path

When moving beyond Milestone 1 prototype logging, use:

| Table | Purpose |
| --- | --- |
| `events` | Durable local event queue using the normalized event envelope. |
| `adapter_cursors` | Last consumed cursor per adapter/session. |
| `outbox` | Events waiting to be delivered to the relay. |
| `sessions` | Local Adam session metadata and adapter session ids. |
| `config` | Local key/value config cache, excluding secrets. |

## Relay/API decisions

| Topic | Decision |
| --- | --- |
| API framework | Fastify. |
| Database | Postgres/Supabase. |
| Realtime daemon link | WebSocket with heartbeat and reconnect. |
| Client feed | SSE first if the feed is read-mostly; WebSocket if prompt status and approvals need one live channel. |
| Prompt path | Client -> relay -> daemon -> adapter -> Codex CLI. |
| Event path | Adapter/daemon -> local event log -> relay -> client feed. |
| Queueing | Start with database-backed pending states; add Redis/BullMQ only when retry volume needs it. |
| Auth | Start with one-user alpha auth, then GitHub OAuth/GitHub App authorization. |

## Pairing and auth flow

1. User signs in to web/PWA.
2. Web/PWA creates a short-lived pairing code.
3. User runs daemon pairing command locally.
4. Daemon exchanges pairing code for a device token.
5. Relay stores the device identity and allowed project/session scope.
6. Daemon opens a WebSocket using the device token.
7. Relay exposes only paired sessions to that user's clients.

Pairing codes must be short-lived, single-use, and scoped. Device tokens must be revocable.

## Storage boundaries

| Data | MVP location | Later options |
| --- | --- | --- |
| Source code | User's local Git repo and GitHub | Cloud runner ephemeral workspace. |
| Local events | JSONL append log in Milestone 1 | SQLite event store once query/cursor needs justify it. |
| Relay events | Postgres/Supabase with limits | User-owned database or premium retention. |
| Large logs/diffs/screenshots | Avoid or store small capped artifacts | S3/R2/Supabase Storage/Cloudinary/BYO. |
| Secrets | Not stored in MVP | Encrypted vault with short-lived runner injection. |
| Hosted workspace disk | Out of scope | Premium Adam-hosted or user-owned runner. |

## Free MVP constraints

- One user.
- One paired daemon.
- One active project/session.
- Small event retention window.
- Small artifact size limit.
- No hosted execution.
- No direct remote shell.
- No multi-agent dashboard.
- No team/org controls.

## Critique and mitigations

| Risk | Critique | Mitigation |
| --- | --- | --- |
| Too many surfaces too early | Desktop, relay, web, mobile, GitHub, and cloud execution can sprawl quickly. | Build web/PWA first and delay native mobile/cloud execution. |
| BYO storage can hurt onboarding | Asking users for Supabase/Mongo/Cloudinary credentials before value is proven will reduce activation. | Keep BYO optional and post-MVP. |
| Laptop-off promise can be misunderstood | The MVP cannot run if the laptop is off. | State clearly that MVP is local remote control; cloud execution is later/premium/BYO runner. |
| Remote control can become unsafe | Prompting an agent remotely can trigger shell/file/repo actions. | Permission events, audit logs, no direct mobile shell in MVP. |
| Project-local state can leak | Local event logs may contain prompt text, file paths, or future token-adjacent metadata. | Store mutable state outside the repo by default and gitignore `.adam/state/`, local databases, and token/secret-like files. |
| Adapter fragility | Tool internals can change or be legally unclear. | Use green-tier integrations first and keep adapters capability-scoped. |
| Cost creep | Realtime, storage, native apps, and hosted execution can add costs before product-market fit. | Use free tiers, dependency-free checks, capped retention, web-first UI. |

## Codex integration implementation findings

Milestone 1 implementation follows patterns seen across real Codex external integrations:

1. Spawn `codex exec --json` and parse NDJSON incrementally.
2. Favor stdin prompt injection (`-`) to avoid shell-quoting and injection issues.
3. Track latest resumable session candidates from `~/.codex/sessions/**/*.jsonl`.
4. Emit normalized `session_started` and `activity` events into local log before cloud relay exists.
5. Treat parser and process errors as first-class states (not silent success).

## Decisions deferred

- Native app release process.
- Stripe billing.
- Cloud runner provider.
- Sandbox technology.
- BYO storage provider priority.
- Team/org policy model.
- Long-term secrets vault.
