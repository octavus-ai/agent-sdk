---
title: GitHub Actions (OIDC)
description: Run an Octavus agent from GitHub Actions without storing a long-lived key.
---

# GitHub Actions (OIDC)

GitHub Actions can mint a short-lived OIDC token for each workflow run. By federating GitHub as an identity provider, a workflow can run one of your agents without any stored `oct_sk_` secret - the token lasts only for the run and is scoped to a single agent.

## Register GitHub as a provider

In your project's **Settings -> Federation**, register a provider:

- **Issuer**: `https://token.actions.githubusercontent.com`
- **Allowed algorithms**: `RS256`
- **Agent scope**: bind it to the specific agent the workflow should run. (GitHub's OIDC token carries fixed claims, so use a bound agent rather than an agent claim.)
- **Claim conditions**: restrict to your repository so only it is trusted, for example `sub` starts with `repo:your-org/your-repo:`. Keep the trailing colon - GitHub subjects look like `repo:org/repo:ref:refs/heads/main`, and the colon stops the prefix from also matching a repository whose name merely starts the same (like `your-repo-fork`).

Copy the generated **audience** - the workflow requests a token for it.

## Workflow

Grant the job `id-token: write`, request a GitHub OIDC token for your audience, and present it to Octavus.

```yaml
name: Run agent
on: workflow_dispatch

permissions:
  id-token: write # required to mint the OIDC token
  contents: read

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install @octavus/server-sdk @actions/core

      - name: Run the agent
        env:
          # The audience Octavus generated for your provider registration.
          OCTAVUS_AUDIENCE: ${{ vars.OCTAVUS_AUDIENCE }}
          OCTAVUS_AGENT_ID: ${{ vars.OCTAVUS_AGENT_ID }}
        run: node run-agent.mjs
```

```javascript
// run-agent.mjs
import * as core from '@actions/core';
import { OctavusClient } from '@octavus/server-sdk';

// GitHub exposes an endpoint to mint an OIDC token for a given audience.
const token = await core.getIDToken(process.env.OCTAVUS_AUDIENCE);

const client = new OctavusClient({ baseUrl: 'https://octavus.ai', apiKey: token });

// The first execute() creates the session and runs the trigger in one request.
const session = client.agentSessions.start({ agentId: process.env.OCTAVUS_AGENT_ID });

const events = session.execute({
  type: 'trigger',
  triggerName: 'user-message',
  input: { USER_MESSAGE: 'Run the nightly report.' },
});

for await (const event of events) {
  // handle stream events
}
```

The workflow never stores an Octavus secret. The OIDC token is valid only for that run, is trusted only from your repository (via the claim condition), and can only run the one agent you bound.

## Notes

- Ephemeral credentials are **session-use only**. Managing agents or syncing definitions still uses a long-lived key with the appropriate permission, kept in trusted compute.
- To stop trusting the workflow, disable or delete the provider in the dashboard - no workflow changes needed.
