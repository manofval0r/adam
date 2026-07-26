# Relay Transport and Reconnect Assumptions

This document defines Milestone 2 transport and reconnect assumptions for the Adam relay service.

## Transport assumptions

1. **Production traffic is HTTPS/WSS only.**
   - Relay endpoints are expected behind TLS termination.
   - `RELAY_ENFORCE_TLS_PRODUCTION=true` rejects insecure production requests. Forwarded `https` is accepted only when proxy trust is enabled and the request comes from a trusted proxy IP.
   - If `RELAY_TRUST_PROXY=true`, relay only accepts forwarded HTTPS from source IPs listed in `RELAY_TRUSTED_PROXY_IPS`.

2. **Local development may use plain HTTP.**
   - This is only for local iteration.
   - Deployment guides must default to TLS enabled.

3. **Device authentication uses bearer tokens.**
   - Device tokens are issued once during pairing exchange.
   - Relay stores only token hashes.
   - Tokens carry expiry timestamps and can be revoked later.

4. **Pairing-code creation is bootstrap-protected.**
   - Pairing code issuance requires `x-relay-bootstrap-key`.
   - This protects user/device enrollment until full user auth is introduced.

5. **Session/device read endpoints require bearer auth.**
   - `GET /v1/sessions` and `GET /v1/devices` derive user scope from authenticated device token.
   - Client-supplied user identifiers are not trusted.

6. **Remote prompt submission requires explicit session consent.**
   - Daemon heartbeats must mark each session `remotePromptConsent=true` before relay accepts remote prompts.
   - If consent is revoked, queued prompts are failed before delivery.

7. **Prompt delivery is idempotent and lease-protected.**
   - Prompt submission requires `clientPromptId` and deduplicates retries by user/session/idempotency key.
   - Daemon dequeues receive a lease window (`RELAY_PROMPT_LEASE_SECONDS`, default 180).
   - Expired in-flight deliveries are re-queued with explicit feed events.

8. **Pairing codes are short-lived and single-use.**
   - Pairing codes expire quickly (`RELAY_PAIRING_CODE_TTL_SECONDS`, default 180).
   - Reuse is rejected.

## Reconnect behavior

1. Relay treats a daemon as **connected** only while heartbeats are fresh.
2. If heartbeat age exceeds `RELAY_HEARTBEAT_STALE_SECONDS`, relay marks the device **disconnected**.
3. Sessions from disconnected devices are marked `disconnected`.
4. The next valid heartbeat transitions device state back to `connected`.
5. Each disconnected->connected transition increments `reconnectCount`.

## Milestone 2 boundary

- These assumptions are transport-level and state-level only.
- Relay currently uses an in-memory store by default and must not run in production without an explicitly configured persistent backend.
- `RELAY_ALLOW_IN_MEMORY_STORE_PRODUCTION=true` is only an emergency single-instance override, not a scalable deployment mode.
- Production deployments with proxy trust enabled must set `RELAY_TRUSTED_PROXY_IPS`; wildcard proxy trust is intentionally rejected.
- End-to-end encryption and hosted secret injection are out of scope for Milestone 2 and remain later milestones.
