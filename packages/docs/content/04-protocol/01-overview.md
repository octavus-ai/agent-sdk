---
title: Overview
description: Introduction to Octavus agent protocols.
---

# Protocol Overview

Agent protocols define how an AI agent behaves. They're written in YAML and specify inputs, triggers, tools, and execution handlers.

## Why Protocols?

Protocols provide:

- **Declarative definition** — Define behavior, not implementation
- **Portable agents** — Move agents between projects
- **Versioning** — Track changes with git
- **Validation** — Catch errors before runtime
- **Visualization** — Debug execution flows

## Agent Formats

Octavus supports two agent formats:

| Format        | Use Case                       | Structure                         |
| ------------- | ------------------------------ | --------------------------------- |
| `interactive` | Chat and multi-turn dialogue   | `triggers` + `handlers` + `agent` |
| `worker`      | Background tasks and pipelines | `steps` + `output`                |

**Interactive agents** handle conversations — they respond to triggers (like user messages) and maintain session state across interactions.

**Worker agents** execute tasks — they run steps sequentially and return an output value. Workers can be called independently or composed into interactive agents.

See [Workers](/docs/protocol/workers) for the worker protocol reference.

## Interactive Protocol Structure

```yaml
# Agent inputs (provided when creating a session)
input:
  COMPANY_NAME: { type: string }
  USER_ID: { type: string, optional: true }

# Persistent resources the agent can read/write
resources:
  CONVERSATION_SUMMARY:
    description: Summary for handoff
    default: ''

# How the agent can be invoked
triggers:
  user-message:
    input:
      USER_MESSAGE: { type: string }
  request-human:
    description: User clicks "Talk to Human"

# Temporary variables for execution (with types)
variables:
  SUMMARY:
    type: string
  TICKET:
    type: unknown

# Tools the agent can use
tools:
  get-user-account:
    description: Looking up your account
    parameters:
      userId: { type: string }

# Octavus skills (provider-agnostic code execution)
skills:
  qr-code:
    display: description
    description: Generating QR codes

# Agent configuration (model, tools, etc.)
agent:
  model: anthropic/claude-sonnet-4-5
  system: system # References prompts/system.md
  tools: [get-user-account]
  skills: [qr-code] # Enable skills
  imageModel: google/gemini-2.5-flash-image # Enable image generation
  agentic: true # Allow multiple tool calls
  thinking: medium # Extended reasoning

# What happens when triggers fire
handlers:
  user-message:
    Add user message:
      block: add-message
      role: user
      prompt: user-message
      input: [USER_MESSAGE]

    Respond to user:
      block: next-message
```

## File Structure

Each agent is a folder with:

```
my-agent/
├── protocol.yaml           # Main logic (required)
├── settings.json           # Agent metadata (required)
└── prompts/               # Prompt templates
    ├── system.md
    ├── user-message.md
    └── escalation-summary.md
```

### settings.json

```json
{
  "slug": "my-agent",
  "name": "My Agent",
  "description": "What this agent does",
  "format": "interactive"
}
```

| Field         | Required | Description                                     |
| ------------- | -------- | ----------------------------------------------- |
| `slug`        | Yes      | URL-safe identifier (lowercase, digits, dashes) |
| `name`        | Yes      | Human-readable name                             |
| `description` | No       | Brief description                               |
| `format`      | Yes      | `interactive` (chat) or `worker` (background)   |

## Naming Conventions

- **Slugs**: `lowercase-with-dashes`
- **Variables**: `UPPERCASE_SNAKE_CASE`
- **Prompts**: `lowercase-with-dashes.md`
- **Tools**: `lowercase-with-dashes`
- **Triggers**: `lowercase-with-dashes`

## Variables in Prompts

Reference variables with `{{VARIABLE_NAME}}`:

```markdown
<!-- prompts/system.md -->

You are a support agent for {{COMPANY_NAME}}.

Help users with their {{PRODUCT_NAME}} questions.

## Support Policies

{{SUPPORT_POLICIES}}
```

Variables are replaced with their values at runtime. If a variable is not provided, it's replaced with an empty string.

## Next Steps

- [Input & Resources](/docs/protocol/input-resources) — Defining agent inputs
- [Triggers](/docs/protocol/triggers) — How agents are invoked
- [Tools](/docs/protocol/tools) — External capabilities
- [Skills](/docs/protocol/skills) — Code execution and knowledge packages
- [Handlers](/docs/protocol/handlers) — Execution blocks
- [Agent Config](/docs/protocol/agent-config) — Model and settings
- [Workers](/docs/protocol/workers) — Worker agent format
- [Provider Options](/docs/protocol/provider-options) — Provider-specific features
- [Types](/docs/protocol/types) — Custom type definitions
