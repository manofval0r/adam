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

### Decisions

- Start with OpenAI Codex CLI as the first integration because it is the lowest-risk control surface.
- Treat Claude Code JSONL and GitHub Copilot official export as the next safest ingestion paths.
- Keep Cursor and Antigravity raw local parsing out of the MVP until legal and format risks are resolved.
- Make cloud-hosted execution a later milestone after local ingestion and relay are stable.
- Treat user-owned databases and object storage as advanced connectors for session state and artifacts, not as a replacement for execution infrastructure.
- Separate premium laptop-off execution from lightweight relay/storage features because agent runtime cost is driven by compute, workspace disk, dependency caches, and sandboxing.
- Prefer a TypeScript-first monorepo for MVP speed, with Postgres/Supabase for relay state, Expo React Native for mobile, Next.js for web, and Node.js TypeScript for the first daemon/API implementation.
- Use normalized events and explicit adapter capabilities as the foundation for the daemon, relay, mobile/web feed, permission gates, and future cloud runners.
- Keep the feasibility MVP free/low-cost by building a responsive web/PWA first, using local SQLite and Supabase/Postgres free-tier relay state, and deferring native mobile, hosted execution, BYO connectors, billing, and sandbox infrastructure.
- Treat pre-permission-gate remote prompt forwarding as local/dev-only until session-level consent, audit events, and blocked approval-state visibility are in place.
