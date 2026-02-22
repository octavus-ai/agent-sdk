# @octavus/cli

CLI for validating and syncing Octavus agent definitions.

## Installation

```bash
npm install -g @octavus/cli
```

Or use with npx:

```bash
npx @octavus/cli validate ./agents/support-chat
```

## Overview

The Octavus CLI provides commands for managing agent definitions from your local filesystem. Use it to:

- **Validate** agent definitions before deploying
- **Sync** agents to the Octavus platform
- **List** and **get** agent details
- **Archive** agents you no longer need

## Configuration

The CLI reads configuration from environment variables:

| Variable              | Description                               | Default              |
| --------------------- | ----------------------------------------- | -------------------- |
| `OCTAVUS_CLI_API_KEY` | API key with agent management permissions | -                    |
| `OCTAVUS_API_KEY`     | Fallback API key (if CLI key not set)     | -                    |
| `OCTAVUS_API_URL`     | Octavus platform URL                      | `https://octavus.ai` |

You can also specify an env file:

```bash
octavus --env .env.production validate ./agents/support-chat
```

## Commands

### validate

Validate an agent definition without making changes (dry-run).

```bash
octavus validate <path>
```

**Options:**

- `--json` - Output as JSON (for CI/CD pipelines)
- `--quiet` - Suppress non-essential output

**Example:**

```bash
octavus validate ./agents/support-chat
# ✓ Agent support-chat is valid

octavus validate ./agents/support-chat --json
# { "slug": "support-chat", "valid": true, "errors": [], "warnings": [] }
```

### sync

Sync an agent to the platform (creates or updates).

```bash
octavus sync <path>
```

**Options:**

- `--json` - Output as JSON
- `--quiet` - Suppress non-essential output

**Example:**

```bash
octavus sync ./agents/support-chat
# ℹ Reading agent from ./agents/support-chat...
# ℹ Syncing support-chat...
# ✓ Updated: support-chat
#   Agent ID: agent_abc123
```

### list

List all agents in the project.

```bash
octavus list
```

**Options:**

- `--json` - Output as JSON
- `--quiet` - Suppress non-essential output

**Example:**

```bash
octavus list
# SLUG                 NAME                           FORMAT       ID
# ─────────────────────────────────────────────────────────────────────
# support-chat         Support Chat                   interactive  agent_abc123
# product-advisor      Product Advisor                interactive  agent_def456
#
# 2 agent(s)
```

### get

Get agent details by slug.

```bash
octavus get <slug>
```

**Options:**

- `--json` - Output as JSON
- `--quiet` - Suppress non-essential output

**Example:**

```bash
octavus get support-chat
# ✓ Agent: Support Chat
#
#   Slug: support-chat
#   ID: agent_abc123
#   Format: interactive
#   Description: Customer support agent with escalation
#
#   Prompts: system, user-message, escalation-summary
```

### archive

Archive an agent by slug (soft delete).

```bash
octavus archive <slug>
```

**Options:**

- `--json` - Output as JSON
- `--quiet` - Suppress non-essential output

**Example:**

```bash
octavus archive support-chat
# ℹ Archiving support-chat...
# ✓ Archived: support-chat
#   Agent ID: agent_abc123

octavus archive support-chat --json
# { "slug": "support-chat", "agentId": "agent_abc123", "archived": true }
```

## Agent Definition Structure

The CLI expects agent definitions in a specific directory structure:

```
my-agent/
├── settings.json     # Required: Agent metadata
├── protocol.yaml     # Required: Agent logic
└── prompts/          # Optional: Prompt templates
    ├── system.md
    └── user-message.md
```

### settings.json

```json
{
  "slug": "support-chat",
  "name": "Support Chat",
  "description": "Customer support agent with escalation",
  "format": "interactive"
}
```

### protocol.yaml

```yaml
input:
  COMPANY_NAME: { type: string }

triggers:
  user-message:
    input:
      USER_MESSAGE: { type: string }

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  input: [COMPANY_NAME]

handlers:
  user-message:
    Add user message:
      block: add-message
      role: user
      prompt: user-message
      input: [USER_MESSAGE]

    Respond:
      block: next-message
```

## CI/CD Integration

Use JSON output mode for CI/CD pipelines:

```bash
# Validate in CI
octavus validate ./agents/support-chat --json
if [ $? -ne 0 ]; then
  echo "Validation failed"
  exit 1
fi

# Deploy to staging
OCTAVUS_API_URL=https://staging.octavus.ai octavus sync ./agents/support-chat --json
```

## Exit Codes

| Code | Description                           |
| ---- | ------------------------------------- |
| 0    | Success                               |
| 1    | Validation/sync error                 |
| 2    | Configuration error (missing API key) |

## License

MIT
