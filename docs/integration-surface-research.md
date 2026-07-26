# Integration Surface Research

This document summarizes practical integration surfaces for the platforms discussed so far, using official docs where available plus implementation patterns observed in real open-source projects.

## Scope

- OpenAI Codex CLI
- Claude Code
- GitHub Copilot (CLI/session stack)
- Google Antigravity
- Cursor
- Claude Cowork

## Evidence-backed patterns

### Codex CLI

**Observed in external implementations**

- `codex exec --json` is used as the primary machine-readable stream (NDJSON).
- Prompt injection is safest via stdin with trailing `-` (instead of shell-quoted prompt args).
- Event parsing typically tracks `thread.started`, `turn.*`, and `item.completed` (`agent_message` text).
- Resumability is commonly tied to session ids found in Codex event output and `~/.codex/sessions/.../*.jsonl`.
- Mature wrappers include timeout handling, spawn error mapping, partial parse tolerance, and final-message guards.

**Representative sources**

- `newtro/mcp-codex-bridge` (`src/codex-runner.ts`)
- `hienlh/ppm` (`codex-cli-poc.ts`)
- `larsderidder/context-lens` (`src/importers/codex.ts`)
- broader corpus from GitHub code search for `codex exec --json` pipelines

**Recommended Adam approach**

- Keep Codex as the first adapter.
- Use stdin + NDJSON parser + explicit failure classification.
- Persist normalized event envelopes locally before relay delivery.

---

### Claude Code

**Officially documented**

- CLI sessions are resumable (`--continue`, `--resume`) and script-friendly.
- Transcript storage is JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`.
- Claude docs explicitly warn transcript file format is internal and can change.
- Preferred machine interfaces are:
  - `claude -p --output-format json|stream-json`
  - `claude -p --resume <session-id>`
  - hooks/statusline `transcript_path`
  - Agent SDK

**Official sources**

- https://code.claude.com/docs/en/sessions
- https://code.claude.com/docs/en/platforms

**Recommended Adam approach**

- Treat Claude Code as ingestion-first via official/script interfaces.
- Avoid tight coupling to undocumented JSONL internals when a stable interface is available.

---

### GitHub Copilot (CLI/session stack)

**Officially documented**

- Copilot CLI stores local session data under `~/.copilot/session-state/`.
- Structured local session data powers `/chronicle`.
- Sessions can sync to GitHub and can be queried/resumed across surfaces.
- Session sharing/export flows are official (`/share`, markdown/html/gist, cloud links where available).

**Official sources**

- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/chronicle
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/chronicle
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents
- https://code.visualstudio.com/docs/agents/sessions/session-sync

**Recommended Adam approach**

- Prefer official export/sync/session interfaces first.
- If local parsing is needed, treat file/db parsing as a compatibility layer with version tolerance and clear unsupported states.

---

### Google Antigravity

**Officially documented**

- Exposed as a managed agent through Gemini Interactions API.
- Supports remote sandbox execution, code/file tools, and MCP servers as tools.
- Allows tool restrictions/customization per interaction.

**Official source**

- https://ai.google.dev/gemini-api/docs/antigravity-agent

**Recommended Adam approach**

- Treat Antigravity as an API-driven adapter (not local-file parsing first).
- Keep as post-MVP expansion while Codex relay loop stabilizes.

---

### Cursor

**Current state in this research pass**

- Cursor docs pages could not be fetched from this environment (`cursor.com/docs` fetch failed), so no stable official external session-history API is verified in this pass.
- Prior planning assumptions about Cursor remain high-risk without explicit provider guidance.

**Recommended Adam approach**

- Keep Cursor in high-risk/experimental tier.
- Do not ship Cursor internals parsing in MVP.
- Revisit only with explicit official docs or written permissions.

---

### Claude Cowork

**Current state in this research pass**

- No reliable official product documentation for a stable external session-export/control surface was verified in this pass.
- Treat ecosystem claims as unverified until official docs/API terms are confirmed.

**Recommended Adam approach**

- Keep as research spike only.
- Do not include in MVP or safety claims until official integration terms are clear.

## Integration strategy decision

1. **MVP adapters:** Codex only.
2. **Next safest ingestion:** Claude Code and GitHub Copilot official session/export surfaces.
3. **API-managed expansion:** Antigravity once relay and permission model are stable.
4. **High-risk defer:** Cursor internals and unverified Cowork surfaces.

## Practical design constraints for all adapters

- Use normalized event envelope from `docs/event-schema.md`.
- Require capability manifests from `docs/adapter-contract.md`.
- Persist local events before relay delivery.
- Fail loudly on unsupported/changed source formats.
- Keep legal/safety boundaries explicit in user-facing labels.
