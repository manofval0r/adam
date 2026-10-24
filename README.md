# adam
A platform across desktop, web and mobile for syncing agent sessions, allowing remote sessions across major coding tools

## Planning documents

- [Master plan](docs/master-plan.md) - long-term product direction, platform strategy, legal/safety model, and end-state architecture.
- [MVP plan](docs/mvp-plan.md) - milestone-by-milestone plan for the first usable product.
- [Normalized event schema](docs/event-schema.md) - shared event model for sessions, activity, permissions, diffs, artifacts, GitHub, CI, and errors.
- [Adapter contract](docs/adapter-contract.md) - interface and safety boundary for integrating Codex CLI and future coding-agent tools.
- [Architecture decisions](docs/architecture-decisions.md) - confirmed MVP technical decisions, stack boundaries, local storage, relay design, and feasibility constraints.
- [Legal/safety risk register](docs/legal-safety-risk-register.md) - integration risk tiers, permission model, consent copy, retention assumptions, and legal review questions.
- [Integration surface research](docs/integration-surface-research.md) - practical integration methods and risk posture across Codex, Claude Code, Copilot, Antigravity, Cursor, and Cowork.
- [Relay transport assumptions](docs/relay-transport-assumptions.md) - Milestone 2 TLS, pairing-token, and reconnect assumptions for relay/device communication.
- [Connector architecture](docs/connector-architecture.md) - plugin layer for connecting external accounts such as Supabase, Gmail, and Google Workspace, shared between the phone and the computer.
- [Cloud platform](docs/cloud-platform.md) - hosting, persistence, retention, and cost model for running the relay unattended on free-tier infrastructure.
- [Continuous checklist](docs/continuous-checklist.md) - live execution checklist for the active milestone and slices.
- [Changelog](docs/changelog.md) - documentation of meaningful planning and implementation changes between commits.

## Implementation plans

Task-by-task plans used to execute the specs above.

- [Shared contracts](docs/superpowers/plans/2026-10-24-shared-contracts.md) - one workspace package owning the event schema, permission vocabulary, and connector contracts.
- [Cloud platform](docs/superpowers/plans/2026-10-24-cloud-platform.md) - Postgres-backed relay store, retention, artifact storage, and deployment tooling.
- [Connector hub](docs/superpowers/plans/2026-10-24-connector-hub.md) - credential vault, connector executor, MCP endpoint, and the first Supabase and Gmail connectors.
- [Agent adapters](docs/superpowers/plans/2026-10-24-agent-adapters.md) - adapter interface extraction, the OpenCode adapter in server-backed mode, and the Claude Code and Copilot ingestion adapters.
