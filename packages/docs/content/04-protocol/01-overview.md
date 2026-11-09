---
title: Overview
description: Introduction to Octavus agent protocols.
---

# Protocol Overview

Agent protocols define how an AI agent behaves. They're written in YAML and specify inputs, triggers, tools, and execution handlers.

## Why Protocols?

Protocols provide:

- **Declarative definition** - Define behavior, not implementation
- **Portable agents** - Move agents between projects
- **Versioning** - Track changes with git
- **Validation** - Catch errors before runtime
- **Visualization** - Debug execution flows

## Agent Formats

Octavus supports two agent formats:

| Format        | Use Case                       | Structure                         |
| ------------- | ------------------------------ | --------------------------------- |
| `interactive` | Chat and multi-turn dialogue   | `triggers` + `handlers` + `agent` |
| `worker`      | Background tasks and pipelines | `steps` + `output`                |

**Interactive agents** handle conversations - they respond to triggers (like user messages) and maintain session state across interactions.

**Worker agents** execute tasks - they run steps sequentially and return an output value. Workers can be called independently or composed into interactive agents.

See [Workers](/docs/protocol/workers) for the worker protocol reference.

## Interactive Protocol Structure

```yaml
# Agent inputs (provided when creating a session)
input:
  COMPANY_NAME: { type: string }
  USER_ID: { type: string, optional: true }

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

# MCP servers (remote services and device capabilities)
mcpServers:
  figma:
    description: Figma design tool integration
    source: remote
    display: title
    title: Figma

# Octavus skills (provider-agnostic code execution)
skills:
  qr-code:
    display: title
    title: Generating QR codes

# Agent configuration (model, tools, etc.)
agent:
  model: anthropic/claude-sonnet-4-5
  system: system # References prompts/system.md
  tools: [get-user-account]
  mcpServers: [figma] # Enable MCP servers
  skills: [qr-code] # Enable skills
  imageModel: openai/gpt-image-2.5-flare # Enable image generation
  webSearch: true # Enable web search
  todoList: true # Enable structured task tracking
  viewImages: true # View images from URLs
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
├── prompts/               # Prompt templates (supports subdirectories)
│   ├── system.md
│   ├── user-message.md
│   └── shared/
│       ├── company-info.md
│       └── formatting-rules.md
└── references/            # On-demand context documents (optional)
    └── api-guidelines.md
```

Prompts can be organized in subdirectories. In the protocol, reference nested prompts by their path relative to `prompts/` (without `.md`): `shared/company-info`.

References are markdown files with YAML frontmatter that the agent can fetch on demand during execution. See [References](/docs/protocol/references).

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
- **Prompts**: `lowercase-with-dashes.md` (paths use `/` for subdirectories)
- **Tools**: `lowercase-with-dashes`
- **Triggers**: `lowercase-with-dashes`

## `display`, `title`, and `description`

Three fields recur across the protocol, and each has one job:

- **`display` is for the UI.** It decides what reaches a person, live and on reload, under one [reveal rule](/docs/protocol/tools#display-modes): `hidden` shows nothing, `title` a labeled card with its status and errors, `stream` the arguments, results, and nested activity too. It never changes what the model sees or what a tool runs with. It exists on tools, MCP servers and their per-tool schemas, skills, the on-demand catalogs, workers, handler steps, and a scope's `references`.
- **`title` is for the UI.** It is the label a person sees wherever a card or a status can show one, in every visible mode, and it never reaches the model. On tools, MCP servers, skills (in `SKILL.md` and as a protocol override), the on-demand catalogs, workers, and references (in the file's frontmatter). On a handler step it labels what the step produces: the card of an operation block (`generate-image`, `transcribe-audio`), the tool or worker card a `tool-call` or `run-worker` step relabels, and for `next-message` the `block-start` event's `title`, which a UI may show as a status line while the model generates. The infrastructure blocks (`add-message`, `start-thread`, `serialize-thread`) are hidden by default and have nothing to label; a `title` on them is accepted and does nothing.
- **`description` documents an entity for whoever consumes it, and that is never the end user.** Where the model is handed the entity, the consumer is the model and the description is prompt text: a tool and its parameters, a worker (the delegation the parent sees), a skill, an MCP server and its tools, a reference (listed in the system prompt), the on-demand catalogs. Where the model never sees the entity, the consumer is the developer: a trigger's `description` and its inputs' descriptions are the agent's API documentation, and a handler step's `description` is an annotation carried into the session trace. Same word, same job, as a `description` in an OpenAPI document.

The validator adds an info-level hint when a visible step or a streaming tool has a `description` and no `title`: the description is not shown, so add a `title` for the label.

## Variables in Prompts

Reference variables with `{{VARIABLE_NAME}}`:

```markdown
<!-- prompts/system.md -->

You are a support agent for {{COMPANY_NAME}}.

Help users with their {{PRODUCT_NAME}} questions.

## Support Policies

{{SUPPORT_POLICIES}}
```

Variables are replaced with their values at runtime. If a variable is not provided, the placeholder is kept as-is.

## Prompt Interpolation

Include other prompts inside a prompt with `{{@path.md}}`:

```markdown
<!-- prompts/system.md -->

You are a customer support agent.

{{@shared/company-info.md}}

{{@shared/formatting-rules.md}}

Help users with their questions.
```

The referenced prompt content is inserted before variable interpolation, so variables in included prompts work the same way. Circular references are not allowed and will be caught during validation.

## Next Steps

- [Input & Variables](/docs/protocol/input-resources) - Defining agent inputs and variables
- [Triggers](/docs/protocol/triggers) - How agents are invoked
- [Tools](/docs/protocol/tools) - External capabilities
- [MCP Servers](/docs/protocol/mcp-servers) - Remote services and device capabilities via MCP
- [Skills](/docs/protocol/skills) - Code execution and knowledge packages
- [References](/docs/protocol/references) - On-demand context documents
- [Handlers](/docs/protocol/handlers) - Execution blocks
- [Agent Config](/docs/protocol/agent-config) - Model and settings
- [Workers](/docs/protocol/workers) - Worker agent format
- [Types](/docs/protocol/types) - Custom type definitions
- [Migrating from v6 to v7](/docs/migration/v6-to-v7) - What changed in v7 and how to move
