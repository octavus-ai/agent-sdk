---
title: Ephemeral Tokens
description: Mint short-lived, scoped tokens from a trusted key and hand them to ephemeral compute.
---

# Ephemeral Tokens

An ephemeral token is a short-lived, scoped credential your backend mints from a trusted long-lived key. You hand the token to the workload that runs the agent - a per-user sandbox, a serverless function, a browser session - so that environment never holds your project key.

## Enable minting

Create (or edit) an API key in the dashboard under your project's **API Keys** page and grant it the **Mint Ephemeral Tokens** permission. Keep this key on your backend; it is the trusted key you mint from.

## Mint a token

```typescript
import { OctavusClient } from '@octavus/server-sdk';

// On your backend, holding the trusted minting key.
const control = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: process.env.OCTAVUS_API_KEY,
});

// Agent-scoped: the runner may create and drive sessions for this one agent.
const { token, expiresAt } = await control.tokens.mint({
  agentId: 'agt_123',
  ttlSeconds: 3600, // optional; defaults to 1 hour, capped at 12 hours
});

// Session-scoped (tightest): create the session yourself, then mint for just it.
const sessionId = await control.agentSessions.create('agt_123');
const scoped = await control.tokens.mint({ agentId: 'agt_123', sessionId });
```

The response is `{ token, jti, expiresAt }`. `token` is an `oct_et_...` string; `jti` identifies it for revocation.

## Use a token

Give the token to the workload and use it exactly like a key:

```typescript
const runner = new OctavusClient({ baseUrl: 'https://octavus.ai', apiKey: token });

// Works only for the scoped agent/session, and only until it expires.
await runner.agentSessions.start(/* ... */);
```

Or call the API directly:

```bash
curl -N -H "Authorization: Bearer oct_et_..." \
  -H "Content-Type: application/json" \
  -d '{"triggerName":"user-message","input":{"USER_MESSAGE":"Hello"}}' \
  https://octavus.ai/api/agent-sessions/SESSION_ID/trigger
```

## Lifetime and scope rules

- **TTL** defaults to 1 hour and is capped at 12 hours. A longer request is clamped down.
- The requested scope must be within the minting key's scope - you can only ever narrow.
- A session-scoped token cannot create sessions or run workers; it only drives its one session.
- The token can never manage agents, skills, or project settings, regardless of the minting key's other permissions.
- A token is honored only while its minting key exists and is unexpired.

## Revoke early

Short lifetimes are the primary bound, but you can revoke a single token immediately:

```typescript
await control.tokens.revoke(token);
```

Revocation is idempotent - revoking an unknown or already-expired token simply resolves with `revoked: false`.

To revoke **everything** a key has minted at once, delete the minting key in the dashboard: tokens die with the key that minted them.
