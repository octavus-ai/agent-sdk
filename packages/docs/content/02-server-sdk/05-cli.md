---
title: CLI
description: Command-line interface for validating and syncing agent definitions.
---

# Octavus CLI

The `@octavus/cli` package provides a command-line interface for validating and syncing agent definitions from your local filesystem to the Octavus platform.

**Current version:** `{{VERSION:@octavus/cli}}`

## Installation

```bash
npm install --save-dev @octavus/cli
```

## Configuration

The CLI requires an API key with the **Agents** permission.

### Environment Variables

| Variable              | Description                                        |
| --------------------- | -------------------------------------------------- |
| `OCTAVUS_CLI_API_KEY` | API key with "Agents" permission (recommended)     |
| `OCTAVUS_API_KEY`     | Fallback if `OCTAVUS_CLI_API_KEY` not set          |
| `OCTAVUS_API_URL`     | Optional, defaults to `https://octavus.ai`         |

### Two-Key Strategy (Recommended)

For production deployments, use separate API keys with minimal permissions:

```bash
# CI/CD or .env.local (not committed)
OCTAVUS_CLI_API_KEY=oct_sk_...  # "Agents" permission only

# Production .env
OCTAVUS_API_KEY=oct_sk_...      # "Sessions" permission only
```

This ensures production servers only have session permissions (smaller blast radius if leaked), while agent management is restricted to development/CI environments.

### Multiple Environments

Use separate Octavus projects for staging and production, each with their own API keys. The `--env` flag lets you load different environment files:

```bash
# Local development (default: .env)
octavus sync ./agents/my-agent

# Staging project
octavus --env .env.staging sync ./agents/my-agent

# Production project
octavus --env .env.production sync ./agents/my-agent
```

Example environment files:

```bash
# .env.staging (syncs to your staging project)
OCTAVUS_CLI_API_KEY=oct_sk_staging_project_key...

# .env.production (syncs to your production project)
OCTAVUS_CLI_API_KEY=oct_sk_production_project_key...
```

Each project has its own agents, so you'll get different agent IDs per environment.

## Global Options

| Option         | Description                                             |
| -------------- | ------------------------------------------------------- |
| `--env <file>` | Load environment from a specific file (default: `.env`) |
| `--help`       | Show help                                               |
| `--version`    | Show version                                            |

## Commands

### `octavus sync <path>`

Sync an agent definition to the platform. Creates the agent if it doesn't exist, or updates it if it does.

```bash
octavus sync ./agents/my-agent
```

**Options:**

- `--json` — Output as JSON (for CI/CD parsing)
- `--quiet` — Suppress non-essential output

**Example output:**

```
ℹ Reading agent from ./agents/my-agent...
ℹ Syncing support-chat...
✓ Created: support-chat
  Agent ID: clxyz123abc456
```

### `octavus validate <path>`

Validate an agent definition without saving. Useful for CI/CD pipelines.

```bash
octavus validate ./agents/my-agent
```

**Exit codes:**

- `0` — Validation passed
- `1` — Validation errors
- `2` — Configuration errors (missing API key, etc.)

### `octavus list`

List all agents in your project.

```bash
octavus list
```

**Example output:**

```
SLUG                  NAME                            FORMAT        ID
────────────────────────────────────────────────────────────────────────────
support-chat          Support Chat Agent              interactive   clxyz123abc456

1 agent(s)
```

### `octavus get <slug>`

Get details about a specific agent by its slug.

```bash
octavus get support-chat
```

## Agent Directory Structure

The CLI expects agent definitions in a specific directory structure:

```
my-agent/
├── settings.json     # Required: Agent metadata
├── protocol.yaml     # Required: Agent protocol
└── prompts/          # Optional: Prompt templates
    ├── system.md
    └── user-message.md
```

### settings.json

```json
{
  "slug": "my-agent",
  "name": "My Agent",
  "description": "A helpful assistant",
  "format": "interactive"
}
```

### protocol.yaml

See the [Protocol documentation](/docs/protocol/overview) for details on protocol syntax.

## CI/CD Integration

### GitHub Actions

```yaml
name: Validate and Sync Agents

on:
  push:
    branches: [main]
    paths:
      - 'agents/**'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm install

      - name: Validate agent
        run: npx octavus validate ./agents/support-chat
        env:
          OCTAVUS_CLI_API_KEY: ${{ secrets.OCTAVUS_CLI_API_KEY }}

      - name: Sync agent
        run: npx octavus sync ./agents/support-chat
        env:
          OCTAVUS_CLI_API_KEY: ${{ secrets.OCTAVUS_CLI_API_KEY }}
```

### Package.json Scripts

Add sync scripts to your `package.json`:

```json
{
  "scripts": {
    "agents:validate": "octavus validate ./agents/my-agent",
    "agents:sync": "octavus sync ./agents/my-agent"
  },
  "devDependencies": {
    "@octavus/cli": "^0.1.0"
  }
}
```

## Workflow

The recommended workflow for managing agents:

1. **Define agent locally** — Create `settings.json`, `protocol.yaml`, and prompts
2. **Validate** — Run `octavus validate ./my-agent` to check for errors
3. **Sync** — Run `octavus sync ./my-agent` to push to platform
4. **Store agent ID** — Save the output ID in an environment variable
5. **Use in app** — Read the ID from env and pass to `client.agentSessions.create()`

```bash
# After syncing: octavus sync ./agents/support-chat
# Output: Agent ID: clxyz123abc456

# Add to your .env file
OCTAVUS_SUPPORT_AGENT_ID=clxyz123abc456
```

```typescript
const agentId = process.env.OCTAVUS_SUPPORT_AGENT_ID;

const sessionId = await client.agentSessions.create(agentId, {
  COMPANY_NAME: 'Acme Corp',
});
```
