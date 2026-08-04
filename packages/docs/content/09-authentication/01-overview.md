---
title: Overview
description: Choosing a credential - long-lived keys, minted ephemeral tokens, or federated identity.
---

# Authentication

Every Octavus API request is authenticated with a Bearer token. Octavus offers three kinds, so you can match the credential to where your code runs.

## The three credentials

| Credential                   | What it is                                                             | Best for                                              |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| **Long-lived API key**       | A project key (`oct_sk_...`) created in the dashboard.                 | Trusted server environments (your backend).           |
| **Minted ephemeral token**   | A short-lived, scoped token you mint on demand from a trusted key.     | Ephemeral or user-reachable compute you hand a token. |
| **Federated identity token** | A token your own identity provider signs; Octavus verifies it offline. | CI, serverless, per-user sandboxes with an IdP.       |

Long-lived keys are the simple default and are documented throughout this reference. This section covers the two short-lived options.

## Why short-lived, scoped credentials

A long-lived project key is only safe to hold in trusted server compute. It grants full session access to the entire project and does not expire, so if it leaks it stays useful until someone deletes it.

When your code runs somewhere your own end users can see or reach - an in-browser chat, a code sandbox, a per-user container - or on ephemeral compute like a CI runner or serverless function, place a credential there that is bounded in two ways:

- **Short-lived** - it stops working on its own within minutes to hours.
- **Scoped** - it can only run one specific agent, and optionally only one specific session. It carries no ability to create, edit, or delete agents, manage skills, or reach any other agent or session.

A credential an end user extracts is then useless beyond its narrow scope and short lifetime.

## Scope

Both short-lived credentials resolve to the same scoped, session-use-only principal:

- **Agent-scoped** - may create and drive sessions for one agent (for a runner that starts its own conversation).
- **Session-scoped** - may only drive one already-created session (the tightest scope; for when your backend creates the session and hands the runner just that session).

Octavus enforces the scope on every request. A session-scoped token cannot act on a different session, an agent-scoped token cannot target a different agent, and neither can enumerate your project or perform any management operation.

## Which to use

- Already have a backend holding a key? **Mint** a token per session and hand it to the runner - the lowest-friction path, and it can be revoked early. See [Ephemeral Tokens](/docs/authentication/ephemeral-tokens).
- Have (or can run) an identity provider and want no Octavus secret in the loop? **Federate** it - your workload signs its own tokens and Octavus verifies them with no per-request call back to Octavus. See [Workload Identity Federation](/docs/authentication/workload-identity-federation).

Existing integrations that use long-lived keys keep working unchanged - adopting short-lived credentials is opt-in.
