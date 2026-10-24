# Connector Architecture

This document specifies Adam's connector system: the plugin layer that lets a user connect an external account once and then use that capability from both the agent running on their computer and the phone in their hand.

A connector is a plugin with a manifest, a lifecycle, a permission tier, and an audit trail. The manifest shape deliberately mirrors the [adapter contract](adapter-contract.md), because an adapter and a connector are the same idea facing opposite directions: an adapter drives a coding agent, a connector drives an external service on the user's behalf. Sharing the shape means the permission gates, event model, and health reporting work identically on both sides.

## Decision summary

| Area | Decision | Rationale |
| --- | --- | --- |
| Plugin model | Connectors with a manifest, mirroring the adapter contract | One concept for "a pluggable external capability", so permission gates and health reporting are built once. |
| Execution home | The relay executes connector calls | The phone must work while the computer is off. Cloud APIs do not need the user's machine. |
| Credential custody | Only the relay holds provider credentials, encrypted | The agent never receives a Gmail refresh token. A compromised agent cannot exfiltrate a connection. |
| Agent-facing transport | Model Context Protocol over Streamable HTTP | Works with Codex CLI, Claude Code, and any MCP client, with no per-tool adapter. |
| Phone-facing transport | REST invoke endpoint over the existing auth | Reuses the pairing and device-token model that already works. |
| Permission model | Reuse the Milestone 4 decision gate, with green, yellow, and red tiers | One permission mechanism for agent actions and connector actions, not two. |
| Scope model | The grant is fixed at connection time and cannot be widened later | The agent may request only what the user already granted. |
| Provider auth | OAuth 2.1 with PKCE, plus API-key and personal-access-token flows | Covers Google, Supabase, and services that do not speak OAuth. |
| Failure behaviour | Fail closed on credential problems, never silently | A broken connection must block the action and ask the user, not retry forever. |
| Audit | Every connector action is recorded with a redacted argument digest | Connector calls reach the user's real data, so the record has to survive them. |

## What a connector is

```ts
type ConnectorManifest = {
  id: string;
  displayName: string;
  version: string;
  riskTier: "green" | "yellow" | "red";
  authKind: "oauth2_pkce" | "api_key" | "personal_access_token";
  capabilities: ConnectorCapabilities;
  scopes: string[];
  scopeRequirements: Record<string, string>;
  instructions?: { connectUrl?: string; notes: string };
};

type ConnectorCapabilities = {
  read: string[];
  write: string[];
  notify: string[];
};

type Connector = {
  manifest: ConnectorManifest;
  authorize(context: ConnectorAuthorizeContext): Promise<ConnectorAuthorization>;
  refresh(context: ConnectorRefreshContext): Promise<ConnectorAuthorization | null>;
  revoke(context: ConnectorRevokeContext): Promise<void>;
  invoke(context: ConnectorInvokeContext): Promise<ConnectorResult>;
  health(context: ConnectorHealthContext): Promise<AdapterHealth>;
};
```

The manifest declares what the connector can do, not what it happens to implement. A client may offer only the capabilities the manifest lists, so a connector that cannot send mail never surfaces a send action. This is the same discipline the adapter contract applies, and it is what lets the phone render a safe subset of actions.

`riskTier` is the connector's default tier. Individual capabilities may be stricter than the connector default, and the stricter value wins.

## Three classes of connector

Every external integration is a connector, and they differ only in what the user gets out of them.

| Class | Examples | Purpose |
| --- | --- | --- |
| Capability | Gmail, Google Calendar, Google Drive, Supabase | Gives the agent and the phone something they could not otherwise reach. |
| Storage | Neon Postgres, Cloudflare R2 | Decides where Adam keeps its own state. Selected once at deploy time, not per user. |
| Notification | Resend email, Expo push | How the relay reaches the user when the agent is blocked. |

Storage and notification connectors are per-deployment rather than per-user, so they are configured at startup and carry no user credential. Capability connectors are per-user and hold encrypted credentials. The execution path and the permission gate are the same for all three.

GitHub, which the current plan treats as a separate integration, becomes a capability connector under this model. That is the point of the model: a new external service is a new manifest and an implementation, not a new subsystem.

## Execution home: the relay executes

The relay performs the provider call. The agent does not.

This is the decision the whole connector system rests on, so it is worth stating the reasoning plainly.

**The phone must work when the computer is off.** Adam's product promise is that you can pick up your phone and see what the agent is doing, or answer a question it is blocked on. If a connector call had to run on the user's laptop, the feature would only work in the one situation where the user is already at their desk, which is the situation the product exists to avoid.

**These are cloud APIs.** Gmail, Calendar, Drive, and Supabase are all reached over the network. There is nothing about them that needs the user's machine. The set of connectors that would genuinely require local execution is small and different: file access, local git, and local shell. Those are adapter concerns and stay with the daemon.

**One credential store is a smaller attack surface.** If the relay holds the credentials, there is exactly one place they exist, it is encrypted at rest, and it is covered by one audit trail. If the agent held them, every agent session would be a copy of a Gmail refresh token, and a prompt injection into the agent would become a credential exfiltration. Keeping provider credentials out of the agent's reach is the single most important security property of this design.

The consequence is that the agent's request to use Gmail becomes an authenticated call to the relay, and the relay performs the Gmail call with the user's stored credential. The agent is a client of Adam's connector API, exactly as it is a client of the adapter API.

## Three surfaces, one execution path

```text
Codex CLI / Claude Code
        |  MCP over Streamable HTTP, Adam-scoped bearer token
        v
   Relay MCP endpoint  ----\
        |                  |
Phone (REST invoke)  ------->  ConnectorExecutor
        |                          |     |         |
   Web client (connect,              |     |         +--> audit log
   review, disconnect) --------------+     +--> permission gate
                                              |
                                              v
                                     provider API call
```

All three surfaces converge on one `ConnectorExecutor`. That is deliberate. A connector action initiated from the phone and one initiated by the agent produce the same permission check, the same audit record, and the same event in the feed. If there were two paths, the phone path would eventually become the unguarded one.

### The MCP endpoint

The relay exposes a single MCP server at `POST /mcp` over Streamable HTTP, in stateless mode. Stateless mode matters because the relay is a horizontally scalable, stateless service with no session affinity; a stateful MCP session would pin a client to one instance and break the moment that instance was reclaimed by its host.

The MCP specification is at revision 2026-07-28. Its authorization rules are prescriptive rather than advisory: an MCP server must implement OAuth 2.1 as an OAuth 2.1 resource server, and must publish RFC 9728 protected resource metadata, which clients use to discover the authorization server. Dynamic Client Registration is deprecated in favour of OAuth Client ID Metadata Documents, so the relay's registration path should not depend on dynamic registration.

The relay therefore serves protected resource metadata at the RFC 9728 well-known path, advertises the relay's authorization server, and requires the RFC 8707 `resource` parameter so tokens are bound to the canonical MCP server URI. Unauthenticated requests receive `401` with a `WWW-Authenticate` header pointing at the metadata; a valid token lacking the required scope receives `403`.

The daemon registers this endpoint with the local agent as an MCP server, passing an Adam-scoped bearer token. Codex CLI and Claude Code both read MCP server configuration, so the agent gains Gmail and Workspace tools without a bespoke integration.

The MCP specification also defines URL elicitation, where a server asks the user to complete a flow in a browser, including OAuth. The relay uses it for the case where a connector needs a credential the agent cannot obtain, such as the user pasting a token it does not have.

### Prefer vendor MCP servers over reimplementation

Google ships official remote MCP servers for its Workspace services, including Gmail, Drive, Docs, Sheets, Slides, Calendar, Chat, and Classroom, each reachable at a dedicated endpoint under `mcp.googleapis.com`. Supabase ships both a hosted MCP server and a registry-listed implementation.

Where a vendor provides an official remote MCP server, Adam should proxy to it rather than reimplement the API surface. Reimplementing Gmail means maintaining quota handling, error semantics, and format compatibility against an API Google is free to change. Proxying means Adam inherits those. The proxy still holds the credential and still applies the grant, the permission tier, and the audit, so the safety model is unchanged.

Two conditions apply. Google's servers require membership of the Workspace Developer Preview Program and an OAuth client explicitly flagged for agent use, so this path is available to Workspace customers and gated for consumer accounts. And the Supabase MCP server exposes tools such as `execute_sql` and `apply_migration` that raise destructive-SQL confirmations, where the meaningful guardrail is a read-only mode rather than the confirmation alone.

Adam's own connectors therefore earn their place by covering what no vendor server does, by supporting consumer accounts, and by keeping the credential in Adam's own vault rather than a third party's.


### The phone and web surfaces

The phone uses `POST /v1/connectors/:connectionId/invoke` with the existing device token. The web client uses the same endpoint for its own actions and adds `POST /v1/connectors/connect` and `DELETE /v1/connectors/:connectionId` for the connect and disconnect lifecycle.

## Credential storage and lifecycle

Credentials are encrypted with envelope encryption.

A per-connection data key encrypts the credential blob with AES-256-GCM. The data key is itself wrapped by a master key held in the environment, and the connection identifier is used as additional authenticated data so a ciphertext cannot be moved into a different row and decrypted successfully. The stored row holds the provider, the ciphertext, the wrapped data key, the nonce, the authentication tag, the granted scopes, the expiry, and the lifecycle status.

The master key is never stored in the database. Rotating it means unwrapping each data key with the old master, re-encrypting with a new data key, and re-wrapping under the new master, all in place and without a downtime window.

**No credential material is ever logged, put in an event, or included in an error message.** Errors that originate at a provider are recorded with the provider's status code and a redacted body, because provider error bodies occasionally echo the request.

### Lifecycle states

```text
pending  --authorize-->  active  --refresh-->  active
                          |                      |
                          |                      v
                          |                  expired
                          |                      |
                          +--revoke--> revoked <-+
```

A connection becomes `expired` when a refresh fails in a way that is not transient, and `revoked` when the user disconnects or the provider reports the grant is gone. Both states block further invocation. There is no path from `expired` back to `active` without the user reconnecting, because a connection that cannot prove it still holds a valid grant must not be used.

### Handling a dead refresh token

Google documents several ways a refresh token stops working, and the connector must treat each as a user-actionable state rather than a transient error:

- The token has not been used for six months.
- The user changed their password and the token carries Gmail scopes.
- The user revoked access in their Google account settings.
- The token expired because the OAuth app was in Testing publishing status, where refresh tokens live exactly seven days.

A refresh attempt that fails with `invalid_grant` moves the connection to `expired`, emits a `connector_connection` event with status `expired`, and notifies the phone. The relay does not retry, does not fall back to a cached access token, and does not silently return stale data. Failing closed is the only safe behaviour, because the alternative is an agent acting on a connection the user believes they revoked.

## Permission model

The connector permission model is the Milestone 4 decision gate, applied to capabilities rather than to agent actions. One mechanism, two subjects.

| Tier | Meaning | Behaviour |
| --- | --- | --- |
| Green | Read-only, no side effects | Allowed on a live connection. Recorded in the audit log. |
| Yellow | Mutating but reversible or recoverable | Allowed on a live connection. Recorded, and the phone is notified. |
| Red | Irreversible, destructive, or spend-incurring | Requires an explicit per-action approval through the existing `permission_request` and `permission_decision` flow. |

The default tier comes from the connector manifest, and a capability may declare a stricter tier. The effective tier is the stricter of the two.

The scope check happens before the tier check and is absolute. An action is permitted only if the requested capability is present in the grant captured at connection time. An agent cannot widen the grant, cannot request a scope the user did not approve, and cannot use one connector's connection to reach another's provider. A connector that is asked for an ungranted capability fails with a scope error and no provider call is made.

The manifest declares which capability justifies which scope, through a `scopeRequirements` map from scope string to capability name. This means the grant a user approves is always explainable: every scope in the manifest traces to a specific capability, and every capability the connector can invoke traces to a scope the user saw. A manifest with a scope no declared capability justifies, or a scope requirement naming an absent capability, fails validation and cannot be registered.

This is the confused-deputy defence. The relay is trusted to hold the credential, so it must never perform an action the user did not authorize, even when the requester is an authenticated agent inside a legitimate session.

### Worked example

A Gmail connector with three capabilities:

| Capability | Tier | Scope | Behaviour |
| --- | --- | --- | --- |
| `message.list` | Green | `gmail.metadata` | Lists message metadata. Allowed once connected. |
| `message.read` | Green | `gmail.readonly` | Reads bodies. Allowed once connected. |
| `message.send` | Yellow | `gmail.send` | Sends mail. Allowed once connected, phone notified, audited. |

`gmail.modify` and permanent deletion are deliberately absent. A delete capability would be red tier and would need a per-action approval, which is more friction than the product currently justifies.

## Provider realities

### Google scope tiers

Google sorts OAuth scopes into three tiers, and the tier of the narrowest scope requested decides the review the app faces.

| Tier | Gmail scopes | Cost to the project |
| --- | --- | --- |
| Non-sensitive | `gmail.labels` | Basic app verification |
| Sensitive | `gmail.send`, `gmail.addons.current.message.metadata` | Additional app verification, roughly 10 business days |
| Restricted | `gmail.readonly`, `gmail.modify`, `gmail.compose`, `gmail.metadata`, `gmail.insert`, `gmail.settings.basic`, `gmail.settings.sharing`, `https://mail.google.com/` | Restricted-scope verification, roughly 6 weeks, plus an annual third-party security assessment |

The distinction that matters most is that reading a mailbox is a restricted scope. A design that assumes Gmail read access is a simple signup step is wrong, and the cost lands in the project plan rather than in the code.

### Google publishing status and the seven-day token

An OAuth client in Testing publishing status issues refresh tokens that expire after seven days, and is limited to one hundred test users who see an unverified-app warning. The exception is a client requesting only the basic profile scopes, where tokens do not expire on that schedule.

This creates three states the connector must handle distinctly:

| Publishing status | Token lifetime | User ceiling | Use |
| --- | --- | --- | --- |
| Testing | 7 days | 100 test users | Development only |
| In production, unverified, personal use | Long-lived, subject to the six-month inactivity rule | 100 new users total over the project lifetime | The founder and early users |
| In production, verified | Long-lived | Unbounded | Public release |

The deliberate choice is to publish the OAuth client to In production status from the outset, even while unverified and in the personal-use category. That removes the seven-day expiry without triggering a security assessment. The project then requests only `gmail.send` at first, which is sensitive rather than restricted, and adds `gmail.readonly` only when reading the mailbox is a proven product need and the six-week verification plus annual assessment has been budgeted for.

This is a sequencing decision with a cost, and it belongs in the plan rather than being discovered during implementation.

### Workspace organizations

A Google Workspace organization is a different situation from a personal Google account. The organization controls which third-party applications may reach its data, and administrators can block specific high-risk scopes outright, including every Gmail scope that reads or sends mail. An application that requests an administrator-blocked scope fails with `access_denied` for those users with no recourse.

Two connector shapes serve this case. A service account with domain-wide delegation authenticates as the application itself and acts on behalf of users the domain authorizes, which removes the per-user consent screen entirely and centralizes scope approval with the administrator. An end-user OAuth connector works too, but each member grants access individually and the administrator can still restrict the scopes available to the application.

For a first release aimed at individuals, the end-user OAuth path is simpler and is what the connector should implement. The service-account path is the correct answer for Workspace customers and belongs in the plan as a later capability rather than an initial complication.

### Supabase

Supabase is the least constrained connector of the three, which makes it the right first one to build.

A Supabase project is reached with an API key or a personal access token, both of which are bearer tokens with no OAuth flow, so there is no consent screen, no verification, and no token expiry policy to design around. The project reference supplies the URL and the key supplies the identity. The PostgREST surface covers reading and writing rows, and the official MCP server already exists for agent-facing use.

The security consideration is entirely about which key the connector holds. Supabase's newer API keys come in two forms. A publishable key, prefixed `sb_publishable_`, carries the anonymous or authenticated role, so row-level security still applies to every query. A secret key, prefixed `sb_secret_`, carries the service role and bypasses row-level security entirely.

A user-owned connector therefore holds the publishable key. The secret key is a server-side credential that must never reach an agent, and a connector that is handed one is operating with a credential that can read and write every row in the project regardless of the policies the project owner wrote. The executor treats a row-level-security-bypassing credential as red tier, and such a credential may not be used for agent-initiated calls at all. A personal access token scoped to a single project and a single set of permissions is the right alternative when the user wants a capability the publishable key's role does not grant.

Read-only mode is the meaningful guardrail on the supplier's own tools. The Supabase MCP server exposes `execute_sql` and `apply_migration`, and it asks for confirmation before destructive statements, but a confirmation prompt is not a control. A connector that runs against the project must be read-only unless the user has explicitly granted a write capability.

## Rate limits and quotas

Provider quotas are part of a connector's contract, not an afterthought. The relay surfaces a provider's throttling as a visible, failed action rather than as a silent retry storm.

| Provider | Documented limit | Consequence for Adam |
| --- | --- | --- |
| Gmail | 1,200,000 quota units per minute per project, 6,000 per minute per user, 80,000,000 units per day per project | Comfortably above Adam's volume. A bursty agent is the only realistic cause of throttling. |
| Calendar | 10,000 requests per minute per project, 600 per minute per user | A connector that pages through a calendar can exceed the per-user limit. |
| Drive | 1,000,000 units per minute per project, 325,000 per minute per user, 1 TB per day | Fine at Adam's scale. |
| Supabase | Auth endpoints are rate limited per IP and project, and respond with a retry hint | Applies to the platform's own auth endpoints rather than to Data REST. |

Google also applies new standard quotas to projects created from 1 May 2026, and quota increases beyond the standard threshold require billing. This is a cost line that arrives with usage rather than with a contract, and it belongs in the cost model. The relay's own headroom monitoring reports against the free-tier ceilings, and a connector action that receives a rate-limit response is recorded as a failure with the provider's retry hint attached.


## Mobile and computer integration

The connector system is what makes Adam a genuinely mobile product rather than a web page that happens to fit on a phone. The two clients share one relay, one set of connections, and one audit trail.

**The agent is blocked and the user is away.** The daemon reports the decision request to the relay, the relay pushes a notification to the phone, the user approves from the phone, and the relay delivers the decision back to the daemon. The agent resumes without the user ever returning to the desk.

**The user wants information, not control.** From the phone, the user asks a question that a connector answers. Because the relay holds the credential and executes the call, this works whether or not the laptop is awake. Asking whether a deploy notification was sent, or what was in a specific email thread, does not require the machine running the agent.

**The agent wants a capability the user already paid for.** The agent calls the Gmail tool through MCP, the relay enforces the grant, and the agent gets the result. The user granted the connection once, in a browser, and both clients can use it.

The synchronization model follows from the relay being the source of truth. The daemon and the phone are both thin clients of the relay with local retry queues and idempotency keys. Neither holds connector credentials, and neither holds the authoritative connection list. A phone that loses its local database can resynchronize entirely from the relay.

Two transport upgrades serve this. The relay-to-client feed moves from three-second polling to server-sent events, so the phone's feed updates as things happen rather than in batches. The push channel carries the wake-up, since a closed app receives nothing over an event stream.

## Audit and events

Every connector action produces a `connector_action` event and a corresponding audit row.

| Field | Content |
| --- | --- |
| Connection and provider | Which connection, which provider |
| Capability and tier | What was invoked, and its effective tier |
| Outcome | `started`, `completed`, `failed`, or `denied` |
| Duration | Elapsed milliseconds |
| Argument digest | SHA-256 of the canonicalized arguments, not the arguments themselves |
| Result digest | SHA-256 of the canonicalized result, for read actions |
| Redacted summary | A short human-readable description with secrets removed |

The digest is what allows an audit trail that proves what happened without storing a second copy of the user's data. For a green-tier read, the argument digest plus a redacted summary is enough to answer the question that actually gets asked later: did the agent read that email, and when.

Connection lifecycle changes produce `connector_connection` events with a status of `connected`, `disconnected`, `expired`, or `revoked`.

The events carry no credential material and no raw provider payload. The full result of a read is retrievable from the provider for as long as the grant lasts, and the artifact store keeps only what the user asked to keep.

## Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Prompt injection reaching a connector | The agent is induced to exfiltrate the user's mail or workspace data | The grant is fixed at connection time, red-tier actions need approval, and every action is audited. Injection can cause approved actions, not new authorities. |
| Scope creep in the connector | A connector requests more than it needs | The manifest declares scopes, and the grant is reviewed at connect time. The narrowest scope that works is the rule. |
| Google verification cost | Restricted scopes add six weeks and an annual assessment | Request `gmail.send` first. Add restricted scopes only with an explicit decision to pay that cost. |
| Token death after seven days | Connections stop working silently in development | Refresh failures move the connection to `expired` and notify the phone. Never retry a dead grant. |
| Provider rate limits | A connector bursts and gets throttled | Per-connector rate limits in the executor, with backoff and a surfaced error rather than a retry storm. |
| Relay as a single custodian of credentials | A relay compromise exposes every connected account | Envelope encryption, minimal key scope, short-lived Adam tokens for agent access, and the full audit trail. |
| Connector sprawl | Every new service becomes a subsystem | One manifest shape, one executor, one permission gate. A new connector is a manifest plus an implementation. |

## Open questions

- Whether the agent-facing MCP server and the phone-facing REST API should share one permission vocabulary or expose different subsets to each surface.
- Whether a connector may be shared between users in a future team product, and what a per-team grant looks like when the credential belongs to one person.
- Whether connector actions should be visible on the same timeline as agent activity or in a separate tab.
- What the right default is when a provider's scope set changes underneath a live connection.
- Whether a user-owned object-storage bucket should be offerable as a storage connector, which would let artifacts survive an Adam account suspension.
