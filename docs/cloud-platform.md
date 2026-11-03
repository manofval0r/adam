# Cloud Platform

This document specifies how Adam runs in production at zero or near-zero cost: where state lives, where the relay runs, how it is redeployed when a free-tier provider reclaims it, and exactly where "free" stops.

It is the hosting counterpart to [Connector architecture](connector-architecture.md). The connector hub stores user credentials and executes external API calls; this document specifies the substrate it executes on.

## Decision summary

| Area | Decision | Rationale |
| --- | --- | --- |
| Core topology | Stateless relay + managed state | Free tiers get reclaimed, suspended, and capacity-limited. If the app holds no state, a dead host is a redeploy, not a data loss. |
| Primary database | Postgres on Neon Free plan | Auto-resumes in milliseconds, has 6-hour instant restore and copy-on-write branching for migration testing. No credit card, no expiry. |
| Fallback database | Postgres on Aiven Free, then Supabase Free | Aiven states free forever with no card and no expiry. Supabase is the second fallback because it bundles auth and storage but pauses after 7 days needing a manual dashboard resume and has no backups on Free. |
| Database access | Pooled connection endpoint | Neon scales compute to zero after 5 minutes; direct connections die on suspend and must reconnect. |
| Relay host | Oracle Always Free Ampere A1, treated as a swappable option | 2 OCPU / 12 GB and 10 TB monthly egress are ample. Not the system of record, because idle instances get reclaimed and capacity is frequently unavailable. |
| Storage | Cloudflare R2 (S3-compatible) | 10 GB free storage with free egress, which removes egress as a cost driver for artifacts. |
| Transactional email | Resend | 3,000 emails/month and 100/day free, domain verification required. |
| Phone push | Expo Push Notifications | Free within fair use, avoids per-device APNs billing complexity at MVP scale. |
| User auth | Adam's existing pairing and device tokens | Already built and working. No third-party auth dependency until a multi-user product requires it. |
| Deployments | Reproducible image plus a redeploy script | The host is assumed to disappear. Recovery must be a single command. |
| Retention | Event and artifact pruning on a schedule | The Neon Free plan writes fail above 1 GB per project. Retention is a correctness requirement, not housekeeping. |

## The governing principle: stateless application, managed state

Every free tier reviewed has a realistic way to disappear without warning:

- Oracle reclaims idle Always Free compute instances after seven days below a 20% CPU, network, and memory threshold.
- Neon suspends compute when monthly CU-hours or egress are exhausted, and keeps running after the free tier changes.
- Supabase pauses a Free project after seven days of low activity and requires a human to restore it from a dashboard.
- Hosted container free tiers generally sleep, evict, or change terms.

None of this is a reason to abandon free tiers. It is a reason to keep state out of the compute tier entirely.

Adam's rule follows from that: **the relay process holds no durable state.** Sessions, devices, events, prompts, decisions, audit records, and connector connections live in Postgres. Artifacts and backups live in object storage. A relay instance can be destroyed at any moment without data loss, and a replacement can be started in another provider's free tier without changing a line of application code.

This is also what makes the connector hub safe. Connector credentials are encrypted at rest in Postgres, not on the host that executes the calls. A reclaimed relay host never leaks a Gmail refresh token.

## Persistent store

### Primary: Neon Free plan

Verified limits:

| Limit | Value |
| --- | --- |
| Projects | 100 |
| Postgres storage | 1 GB per project, 20 GB total across the account |
| Compute | 100 CU-hours per project per month, autoscaling to 2 CU (about 8 GB RAM) |
| Idle behavior | Compute scales to zero after 5 minutes, resumes automatically in a few hundred milliseconds |
| Public egress | 5 GB per project per month |
| Branches | 10 per project, copy-on-write |
| Instant restore | 6-hour history window, capped at 1 GB of change history |
| Credit card | Not required |

Three properties make Neon the right primary for Adam specifically.

**Branching.** A branch is a copy-on-write clone of the database, storage, and functions. Schema migrations can be applied and tested on a branch before they touch the production branch, then merged. For a project whose persistence layer is being built from scratch and will change often, this removes an entire class of mistake.

**Instant restore.** The six-hour restore window is the recovery path for a bad migration or an accidental `DROP TABLE`. The Supabase Free plan has no automated backups at all, which means on that tier a dropped table is simply gone. On Neon, it is a restore.

**Automatic resume.** Neon wakes suspended compute in a few hundred milliseconds. Supabase's equivalent requires a person to open a dashboard, which is exactly the failure mode a solo founder forgets.

Two hard constraints come with it, and both must be designed for rather than discovered.

When CU-hours or egress are exhausted, compute is suspended until the next billing period. Data survives and the application goes down. This is survivable precisely because the relay is stateless and redeployable, but it must be monitored.

When a project exceeds 1 GB of storage, writes that increase storage fail. The connection does not drop and no error is raised at the transaction level; the write is rejected. Retention therefore has to be enforced, not merely intended.

### Fallbacks: Aiven Free, then Supabase Free

Aiven's free tier is the stronger fallback on its stated terms: it is described as always free with no trial period, no expiry date, and no credit card or payment details required. The exact per-service CPU, memory, and storage caps are published on per-service pages that render client-side, so they need confirming against a live account rather than being asserted here.

Supabase Free remains the second fallback because it bundles Auth, Storage, and Edge Functions that a later phase may want, and because the migration path is the same Postgres dialect. It is not the primary because the manual resume is an unattended outage and there is no restore path.

| Limit | Value |
| --- | --- |
| Active projects | 2 across organizations where the user is Owner or Admin |
| Postgres storage | 500 MB per project |
| Compute | Nano instance, about 0.5 GB RAM, always on |
| Auth | 50,000 monthly active users |
| File storage | 1 GB |
| Edge function invocations | 500,000 per month |
| Idle behavior | Paused after roughly 7 days of inactivity, resumed manually from the dashboard |
| Backups and branching | Not included on the Free plan |
| Log retention | 1 day |

### Schema and retention

The Postgres schema holds the relational core only: users, devices, sessions, prompts, decisions, events, audit records, connector connections, and connector action records. Payloads that do not need to be queried relationally, including diffs, logs, and screenshots, live in object storage and are referenced by URL.

Retention is fixed and enforced by a scheduled pruning job:

| Data | Retention | Rationale |
| --- | --- | --- |
| Events | 30 days | Enough to reconstruct a session; beyond this the value collapses. |
| Artifacts | 14 days | Diff and log context is only useful near the decision it explains. |
| Prompts and decisions | 90 days | Permission history is the audit surface and must outlive the session. |
| Connector actions | 90 days | Same reasoning; connector calls are security-relevant. |
| Sessions | 90 days after end | Session continuity matters only while the session is live or recent. |

Pruning runs daily and is idempotent. A background check reports storage headroom against the 1 GB project ceiling, and the relay raises an explicit warning event when free-tier headroom drops below 20 percent.

### Connection management

Neon suspends compute after five minutes of inactivity, which invalidates open direct connections. The relay therefore uses the pooled connection endpoint, holds a bounded pool, and treats a dropped connection as a reconnect rather than an error. Reconnection is exercised by a test that kills the pool and asserts the next query succeeds.

## Relay host

### Oracle Always Free: what it actually provides

Oracle reduced the Ampere A1 Always Free entitlement to 2 OCPU and 12 GB of RAM per tenancy, effective 2026-08-18, down from the previously documented 4 OCPU and 24 GB. This is recent enough that most published guides still quote the older figure, and it is the single most important correction to make before sizing anything.

| Entitlement | Value |
| --- | --- |
| Ampere A1 compute | 2 OCPU and 12 GB total, `VM.Standard.A1.Flex`, drawn as 1,500 OCPU-hours and 9,000 GB-hours per month |
| AMD compute | `VM.Standard.E2.1.Micro`, 1/8 OCPU and 1 GB RAM, up to 2 instances, 50 Mbps internet bandwidth |
| Block volume | 200 GB total across boot and data volumes, plus 5 volume backups |
| Object storage | 20 GB, with 50,000 API requests per month in the always-free state |
| Outbound data transfer | 10 TB per month |
| Public IPv4 | 2 ephemeral addresses per VM instance, plus 50 reserved addresses per region |
| Networking | Up to 2 virtual cloud networks per tenancy; outbound TCP port 25 blocked by default |
| Always Free databases | Two Autonomous AI Database instances at 20 GB each, and MySQL HeatWave |
| Regional constraint | Always Free compute and volumes are provisioned in the immutable home region |

**There is no Always Free Postgres on Oracle.** Oracle Database with PostgreSQL is a paid managed service. The only always-free relational options are Autonomous AI Database, which is Oracle-flavored and MySQL-compatible HeatWave. Either would mean abandoning standard Postgres, which is precisely the wrong trade for a project whose persistence layer is being written now.

### The six Oracle risks that shape the design

**Idle reclamation.** An Always Free instance can be reclaimed after seven days in which CPU, network, and memory usage all stay below 20 percent. For A1 instances the CPU metric is the 95th percentile. A relay serving a handful of users is precisely the workload this rule targets: it is idle most of the time by design. A keepalive job can hold usage above the threshold, but that is a permanent tax on the instance and it depends on a threshold Oracle can change without notice.

**Capacity unavailability.** Launching free A1 capacity fails regularly with an out-of-host-capacity error that resolves only when Oracle adds capacity, which can take days. Always Free compute and Autonomous databases are provisioned in the account's home region only, so the home region choice at signup is not reversible in any practical sense.

**Account dormancy.** Free accounts that go idle for thirty days or more can be deemed abandoned and suspended or terminated.

**Instance-local storage.** Anything written to the instance's block volume disappears with the instance. There is no disk that is safe to treat as durable.

**Over-provisioning is deleted, not billed.** A1 instances that exceed the free 2 OCPU and 12 GB allocation are disabled and then deleted after thirty days unless the account is upgraded to a paid one. Staying inside the free envelope is therefore a correctness constraint on the deployment, not merely an economic preference. A relay that scales past 2 OCPU does not start accruing cost; it starts disappearing.

**The home region is permanent.** The region chosen at tenancy creation cannot be changed afterward, and Always Free compute, Always Free volumes, and the Autonomous databases are all provisioned there. A region chosen into a capacity drought is a region that stays in one. This is the one decision in the whole platform that cannot be reversed, so it gets deliberate attention rather than a default.

### The resulting posture

Oracle Always Free is a good host for the relay application and a bad place to keep anything that matters. The posture follows directly:

- The relay is stateless, so an instance reclaim is a redeploy.
- All state is in Neon, so an instance reclaim is not a data loss.
- A keepalive job runs on an external scheduler to keep the instance above the idle threshold.
- A redeploy script rebuilds and restarts the relay against the same Neon database.
- Object storage holds the artifacts and the database backups, so the instance disk holds nothing unique.

Two operational consequences of the Always Free constraints follow from this.

There is no managed TLS termination on a bare Oracle public IP, so the relay terminates TLS itself with a reverse proxy and a managed certificate. Certificates are obtained and renewed by the same redeploy tooling, because a certificate that silently expires on a host nobody is watching is an outage with no error message in the feed.

Outbound TCP port 25 is blocked by default, so the relay cannot speak SMTP directly to a mail server. All outbound mail goes through an email API over HTTPS. This is not a limitation worth working around; sending credentials to a mail API over TLS is safer than sending them to a mail relay over STARTTLS.

One further number is worth keeping in view when sizing. Oracle's own free database container caps the database at 2 GB of RAM, which is the vendor's own assessment of a workable floor. The AMD micro shape's 1 GB is below it. This is the practical reason the database does not live on the Oracle instance at all, independent of the idle-reclamation argument.

The same posture means another provider's free tier can be substituted without code changes. That substitutability, not the specific provider, is the thing being bought.

### Other host options

The relay is a standard Node.js HTTP service and is not tied to Oracle specifics. The container-image-plus-redeploy model used for Oracle applies equally to any alternative free container host, which gives a fallback path if the home region has no capacity or the account is reclaimed. Node.js publishes official `linux-arm64` builds, so the A1 instance runs the same artifact as an x86 host with no separate build.

## Supporting services

| Need | Service | Free allowance | Where free ends |
| --- | --- | --- | --- |
| Artifacts, backups | Cloudflare R2 | 10 GB-month storage, 1M Class A operations, 10M Class B operations, and free egress to the internet | Class A at $4.50 per million and Class B at $0.36 per million. The free allowance covers Standard storage only, not Infrequent Access. |
| Transactional email | Resend | 3,000 emails per month, 100 per day | Above 100 per day or 3,000 per month, Pro starts at $20 per month. |
| Phone push | Expo Push Notifications | No charge, up to 600 notifications per second per project | The service is free by current statement rather than by contract, so it can be withdrawn. Requests above the rate limit fail outright. |
| User authentication | Adam device tokens | Unlimited | A commercial auth provider if a multi-user product needs SSO. |
| Backup storage | Cloudflare R2 | Included in the 10 GB-month above | The `pg_dump` files of a small database fit comfortably inside the same allowance. |

Two of these need attention before anything else ships. Resend requires a domain to be added and verified before it will send anything, which means DNS TXT records have to exist before the relay can notify a blocked agent. And the daily email cap is the tighter constraint than the monthly one: a single runaway loop can exhaust a month's allowance in three days, so the relay rate-limits its own outbound notifications rather than trusting the provider to reject them.

Object storage is deliberately S3-compatible so the artifacts bucket can move between providers without touching application code. Backups of the Postgres database are written to that bucket on a schedule and are the only copy outside the managed database's own restore window.

### Free tiers can be retired

The strongest argument for keeping the storage layer portable is that free tiers are withdrawn in practice. CockroachDB's always-free serverless tier no longer appears on its pricing page, replaced by credit-based tiers and a 30-day trial. AWS's free account plan is explicitly $100 of credit for six months, which is a discount on a future bill rather than free capacity. Railway's free tier is a one-time $5 credit that expires in 30 days.

None of these break Adam, because none of them hold Adam's state. They do mean the relay host must be replaceable, and that the choice of storage provider should be revisited rather than treated as permanent.

### Where the always-on alternative costs real money

If the free host is unavailable in its home region, or the account is reclaimed, the cheapest genuinely always-on worker is a small Fly.io machine: 256 MB at $2.19 per month, 512 MB at $3.69, and 1 GB at $6.70. A 256 MB machine is too thin for Postgres plus the relay, so 512 MB is the realistic floor and 1 GB is comfortable. Add offsite backup storage and the honest production floor is roughly $7 to $10 per month, which is the number to hold in mind as the plan's first real budget line.

### Licensing note

Every dependency in the current stack is permissively licensed: PostgreSQL under the PostgreSQL License, Fastify, Zod, Vitest, and the Model Context Protocol SDKs under MIT, TypeScript and the Google API client under Apache 2.0, and Auth.js under ISC.

One exception is worth naming now so it does not surface later. Redis 8.x is tri-licensed under RSALv2, SSPLv1, and AGPLv3. The RSAL and SSPL options are not OSI-approved, and the AGPL option is strong copyleft. Redis 7.2 and earlier remain under a BSD 3-Clause grant, but a relay that depends on a job queue built on Redis pulls the server license into the project's posture. If a queue is ever needed, Valkey is the drop-in replacement under BSD 3-Clause.


## Deployment topology

```text
Phone (web app, later Expo)
   |  HTTPS, SSE feed
   v
Relay  -- stateless, redeployable
   |     |         |          |          |
   |     |         |          |          +--> Push (Expo)
   |     |         |          +--> Email (Resend)
   |     |         +--> Object storage (R2): artifacts, backups
   |     +--> Postgres (Neon): users, devices, sessions, events,
   |              prompts, decisions, audit, connector connections
   |
   +--> MCP endpoint (Streamable HTTP): connector tools
   ^
   |  Adam-scoped bearer token
Desktop Daemon  -- runs on the user's computer
   |
   v
Codex CLI / Claude Code  -- the agent
```

The relay appears once because it is stateless. There is no session affinity, no sticky routing, and no in-process cache that must be shared between instances. Two relay instances behind a load balancer serve the same users correctly, which is what makes the free tier's habit of evicting instances survivable.

## Operational runbook

These are the procedures that must exist before the relay is considered production-ready. Each is a script or a scheduled job, not a manual step.

| Procedure | Trigger | Outcome |
| --- | --- | --- |
| Deploy | Manual | Build the image, push it, restart the relay, confirm the health endpoint |
| Redeploy | Host lost or reclaimed | Same as deploy, against the same Neon database, with no data migration |
| Database backup | Daily | Dump to the R2 bucket, verify the dump is non-empty, report failure loudly |
| Database restore | On demand or on a failed migration | Restore into a Neon branch first, verify, then promote |
| Retention prune | Daily | Delete expired events and artifacts, report reclaimed bytes |
| Free-tier headroom check | Daily | Report database storage and egress against the free limits |
| Keepalive | Hourly, external scheduler | Drive the relay host above the idle-reclamation threshold |
| Credential rotation | Scheduled | Rotate the credential encryption key by re-encrypting with a new data key |

The credential rotation procedure matters because connector credentials live encrypted in the database. A key rotation that re-encrypts in place with a new data key under the same key-encryption key avoids a full downtime window.

## Cost model

The honest summary for a solo founder:

Adam's free path holds until roughly a few hundred active users, provided three things are respected: the database stays under 1 GB per project, the relay host stays under 2 OCPU and 12 GB of RAM, and notification volume stays under 100 emails per day. The first realistic paid need is not the database, which scales to per-use pricing on Neon without a monthly minimum. It is notification volume and, more likely, the moment a hosted database's free compute suspends in the middle of a working session.

Two failure modes are worth naming plainly. A free-tier policy change is the most likely event, and the stateless-application design means the response is a migration to another provider rather than a rewrite. A home-region capacity drought is the second, and the response is a different region or a different provider.

## Open questions

- Whether the relay needs its own connection to Neon outside the pooled endpoint, for administrative operations such as branch creation and restore.
- The exact retention boundary between the 30-day event window and the 90-day decision window, which determines how much the decision history depends on events that have already been pruned.
- Whether artifact storage should stay on the Adam account or move to a user-owned bucket, which affects whether artifacts survive Adam's account being suspended.
- The backup verification method for a hosted Postgres, given that `pg_dump` against a scaled-to-zero compute is not a routine operation.
