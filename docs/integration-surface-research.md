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

### OpenCode

**Naming hazard**

Two unrelated projects share the name. The active one is `anomalyco/opencode`, formerly `sst/opencode` before the organisation was renamed in September 2026, published on npm as `opencode-ai`. The Go project at `opencode-ai/opencode` is a different tool and was archived in September 2025. Any integration must target the former.

**Officially documented**

- Headless mode is `opencode run [message..]`, and `--format json` switches the output from formatted text to a raw JSON event stream.
- Session continuity is `--session <id>` to continue a specific session, `--continue` for the most recent one, and `--fork` to branch before continuing.
- `opencode serve` runs a headless HTTP server, and `opencode run --attach http://localhost:4096` attaches a run to an already-running server instead of starting a new one.
- MCP is first-class, with `opencode mcp add`, `list`, `debug`, and OAuth support through `opencode mcp auth`. OAuth tokens are stored at `~/.local/share/opencode/mcp-auth.json`.
- `OPENCODE_CONFIG_CONTENT` supplies configuration for a single invocation, which allows MCP servers to be injected per run without editing the user's `opencode.json`.
- Session state lives in a SQLite database at `~/.local/share/opencode/opencode.db`. `opencode session list --format json`, `opencode export <id>`, and `opencode import session.json` are the documented session interfaces.
- Two primary agents ship: `build`, which has full access and is the default, and `plan`, which denies file edits except for plan files but still permits bash unless it is restricted.
- The architecture is client-server by construction. The terminal UI, the desktop app, the editor extensions, and the generated SDK are all clients of the same server.

**Observed in external implementations**

- Wrappers invoke `opencode run --format json` with the prompt on stdin and capture the session id from the event stream.
- Newer builds advertise `--dangerously-skip-permissions`, which older builds do not have. Wrappers detect the flag rather than assuming it.
- Follow-up turns continue the native session with `-s <session-id>` rather than replaying history.

**Licensing**

MIT licensed, maintained by the team behind SST under the Anomaly organisation. The licence permits commercial use and automation without restriction.

**Official sources**

- https://opencode.ai/docs/cli/
- https://github.com/anomalyco/opencode
- https://opencode.ai/docs/mcp-servers/

**Recommended Adam approach**

- Treat OpenCode as the second full adapter, and the one that best matches Adam's open-source posture: MIT licensed, provider-agnostic, and able to run against local models.
- Prefer the server-backed mode. Running `opencode serve` once and attaching with `--attach` keeps the MCP connection to Adam's connector hub alive between prompts, which avoids re-running OAuth on every prompt and avoids re-bootstrapping the connector MCP endpoint.
- Use `OPENCODE_CONFIG_CONTENT` to inject the relay's MCP endpoint per invocation rather than mutating the user's `opencode.json`.
- Use `opencode session export` for ingestion rather than reading `opencode.db` directly, so the adapter is not coupled to an undocumented database schema.
- Never pass `--dangerously-skip-permissions`. OpenCode has its own approval flow, and Adam's product promise is to forward that approval to the phone, not to bypass it.

---

### Claude Code

**Officially documented**

- Headless mode is `claude -p "prompt"`, and the output format is chosen with `--output-format`, which accepts `text`, `json`, and `stream-json`. The streaming format is newline-delimited JSON, one event object per line.
- `--output-format stream-json --verbose --include-partial-messages` delivers tokens as they are generated.
- Session continuity is `--continue` for the most recent conversation and `--resume <session-id>` for a specific one. The session id can be captured from the JSON result with `jq -r '.session_id'`.
- Transcript storage is JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`. Claude documents this format as internal and liable to change.
- Permission requests can be answered by a host. The Agent SDK exposes a `canUseTool` callback, and the CLI exposes `--permission-prompt-tool`, which names an MCP tool that answers permission prompts.
- A `PermissionRequest` hook fires for permission requests, and `--permission-prompts none` tells the run that nobody is available to answer. It requires Claude Code v2.1.259 or later.
- Permission modes are `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, and `manual`. The `manual` alias requires v2.1.200 or later, and from v2.1.302 a `claude -p` run with no permission mode set starts in Manual mode.
- `--dangerously-skip-permissions` is an alias for `--permission-mode bypassPermissions`.
- `--allowedTools` pre-allows specific tools for the run, and `--no-session-persistence` suppresses session storage.

**Official sources**

- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/sessions
- https://code.claude.com/docs/en/cli

**Recommended Adam approach**

- Treat Claude Code as a full adapter rather than ingestion-only, because the permission host is a documented, supported interface.
- Use `--permission-prompt-tool` to answer permission requests with an MCP tool served by Adam's relay. The relay turns that tool call into a `permission_request` event, waits for the phone's decision, and returns the answer. This is the same MCP path the connector hub already uses, so it needs no second mechanism.
- Do not use `--permission-prompts none` while a human is reachable, because it removes the tools that need an answer and converts a permission request into a denial. It is only correct for unattended scheduled runs.
- Never use `--dangerously-skip-permissions`. The Manual permission mode is the correct mode for a remote-controlled run, because it makes the tool wait for a decision instead of assuming one.
- Read transcripts through the documented JSONL only as an ingestion fallback, with version tolerance, and prefer the JSON output format for anything the daemon drives.

---

### GitHub Copilot CLI

**Officially documented**

- Prompt mode is `copilot -p "prompt"`, which executes one turn and exits. The exit summary includes a `copilot --resume=SESSION-ID` hint for continuing the session.
- `--output-format json` emits structured JSONL in prompt mode, and `-s` or `--silent` suppresses statistics so only the agent response is emitted.
- `--resume[=VALUE]` resumes by session id, name, or a seven-character hex prefix. `--continue` resumes the most recent session. A bare `--resume` shows an interactive picker and fails without a TTY, so a programmatic caller must pass an explicit id.
- `--connect[=sessionId]` reconnects to a running session, which the documentation describes as intended for remote control. It arrived in v1.0.32.
- `--name` gives a session a name, `--session-idle-timeout` overrides the idle timeout, and `--share=PATH` or `--share-gist` export the transcript after a non-interactive run.
- `--trust-folder` trusts the working directory's hooks, workspace MCP servers, and repository plugin settings for a single non-interactive session. It cannot be combined with `--resume`, `--continue`, or `--session-id`, and it grants no tool, path, or URL permissions of its own.
- `--no-ask-user` prevents the agent from pausing to ask for input.
- Session data is stored locally and synced to the user's GitHub account by default. `--sync-session=off` disables the sync. The `/chronicle` and `/session` slash commands expose session history, checkpoints, files, and plan information.
- Local logs are written under `~/.copilot/`, one file per session id.

**MCP caveat**

The release notes record that headless and SDK sessions without an OAuth handler skip MCP connections when the saved token requires a sign-in, while renewable grants still connect. A connector hub protected by OAuth therefore may not be reachable from an unauthenticated headless Copilot run.

**Official sources**

- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/chronicle

**Recommended Adam approach**

- Treat Copilot CLI as a full adapter with remote control built in, because `--connect` exists specifically for reconnecting to a running session.
- Use the JSONL output format for streaming and capture the session id from the exit summary so a later prompt can resume it.
- Never combine `--trust-folder` with a resumed session, and never use it without the user having reviewed the hooks and MCP servers in that directory.
- Account for the MCP OAuth caveat explicitly. The connector hub must be reachable by a token the headless run can present, and the daemon must detect the case where the connection was skipped rather than assuming the tools are available.
- Keep the local session store out of scope. The documented export and session interfaces are sufficient, and the local store is not a documented interface.


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
2. **Second full adapter:** OpenCode. It is the strongest candidate because it is MIT licensed, publishes a documented JSON event stream, speaks MCP with OAuth, and can run against local models.
3. **Third full adapter:** Claude Code. Its `--permission-prompt-tool` flag accepts an MCP tool as the permission host, which is exactly the mechanism Adam needs to forward an approval to the phone. It is a documented interface, not an undocumented one.
4. **Fourth full adapter:** GitHub Copilot CLI. Its `--connect` flag exists specifically for reconnecting to a running session, which is the remote-control use case Adam is building.
5. **Ingestion fallback:** Claude Code JSONL transcripts and the Copilot session export, for sessions Adam did not drive.
6. **API-managed expansion:** Antigravity once relay and permission model are stable.
7. **High-risk defer:** Cursor internals and unverified Cowork surfaces.

Three of the four adapters can answer a permission request through an MCP tool or an equivalent host. That convergence matters, because it means the connector hub's MCP surface is also Adam's permission transport, and the phone-facing approval flow is written once rather than once per agent.

## Practical design constraints for all adapters

- Use normalized event envelope from `docs/event-schema.md`.
- Require capability manifests from `docs/adapter-contract.md`.
- Persist local events before relay delivery.
- Fail loudly on unsupported/changed source formats.
- Keep legal/safety boundaries explicit in user-facing labels.
- Detect optional flags at runtime rather than assuming a build has them. Tool CLIs add flags between versions.
- Prefer a long-lived tool server over a spawn-per-prompt wrapper where the tool offers one, so MCP connections and OAuth state are not rebuilt on every prompt.
