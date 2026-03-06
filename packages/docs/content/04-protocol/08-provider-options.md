---
title: Provider Options
description: Configuring provider-specific tools and features.
---

# Provider Options

Provider options let you enable provider-specific features like Anthropic's built-in tools and skills. These features run server-side on the provider's infrastructure.

> **Note**: For provider-agnostic code execution, use [Octavus Skills](/docs/protocol/skills) instead. Octavus Skills work with any LLM provider and run in isolated sandbox environments.

## Anthropic Options

Configure Anthropic-specific features when using `anthropic/*` models:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  anthropic:
    # Provider tools (server-side)
    tools:
      web-search:
        display: description
        description: Searching the web
      code-execution:
        display: description
        description: Running code

    # Skills (knowledge packages)
    skills:
      pdf:
        type: anthropic
        display: description
        description: Processing PDF document
```

> **Note**: Provider options are validated against the model provider. Using `anthropic:` options with non-Anthropic models will result in a validation error.

## Provider Tools

Provider tools are executed server-side by the provider (Anthropic). Unlike external tools that you implement, provider tools are built-in capabilities.

### Available Tools

| Tool             | Description                                  |
| ---------------- | -------------------------------------------- |
| `web-search`     | Search the web for current information       |
| `code-execution` | Execute Python/Bash in a sandboxed container |

### Tool Configuration

```yaml
anthropic:
  tools:
    web-search:
      display: description # How to show in UI
      description: Searching... # Custom display text
```

| Field         | Required | Description                                                           |
| ------------- | -------- | --------------------------------------------------------------------- |
| `display`     | No       | `hidden`, `name`, `description`, or `stream` (default: `description`) |
| `description` | No       | Custom text shown to users during execution                           |

### Web Search

Allows the agent to search the web using Anthropic's built-in web search:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  anthropic:
    tools:
      web-search:
        display: description
        description: Looking up current information
```

> **Tip**: Octavus also provides a **provider-agnostic** web search via `webSearch: true` in the agent config. This works with any LLM provider and is the recommended approach for multi-provider agents. See [Web Search](/docs/protocol/agent-config#web-search) for details.

### Code Execution

Enables Python and Bash execution in a sandboxed container:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  anthropic:
    tools:
      code-execution:
        display: description
        description: Running analysis
```

Use cases:

- Data analysis and calculations
- File processing
- Chart generation
- Script execution

> **Note**: Code execution is automatically enabled when skills are configured (skills require the container environment).

## Skills

> **Important**: This section covers **Anthropic's built-in skills** (provider-specific). For provider-agnostic skills that work with any LLM, see [Octavus Skills](/docs/protocol/skills).

Anthropic skills are knowledge packages that give the agent specialized capabilities. They're loaded into Anthropic's code execution container at `/skills/{skill-id}/` and only work with Anthropic models.

### Skill Configuration

```yaml
anthropic:
  skills:
    pdf:
      type: anthropic # 'anthropic' or 'custom'
      version: latest # Optional version
      display: description
      description: Processing PDF
```

| Field         | Required | Description                                                           |
| ------------- | -------- | --------------------------------------------------------------------- |
| `type`        | Yes      | `anthropic` (built-in) or `custom` (uploaded)                         |
| `version`     | No       | Skill version (default: `latest`)                                     |
| `display`     | No       | `hidden`, `name`, `description`, or `stream` (default: `description`) |
| `description` | No       | Custom text shown to users                                            |

### Built-in Skills

Anthropic provides several built-in skills:

| Skill ID | Purpose                                         |
| -------- | ----------------------------------------------- |
| `pdf`    | PDF manipulation, text extraction, form filling |
| `xlsx`   | Excel spreadsheet operations and analysis       |
| `docx`   | Word document creation and editing              |
| `pptx`   | PowerPoint presentation creation                |

### Using Skills

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  anthropic:
    skills:
      pdf:
        type: anthropic
        description: Processing your PDF
      xlsx:
        type: anthropic
        description: Analyzing spreadsheet
```

When skills are configured:

1. Code execution is automatically enabled
2. Skill files are loaded into the container
3. The agent can read skill instructions and execute scripts

### Custom Skills

You can create and upload custom skills to Anthropic:

```yaml
anthropic:
  skills:
    custom-analysis:
      type: custom
      version: latest
      description: Running custom analysis
```

Custom skills follow the [Agent Skills standard](https://agentskills.io) and contain:

- `SKILL.md` with instructions and metadata
- Optional `scripts/`, `references/`, and `assets/` directories

### Octavus Skills vs Anthropic Skills

| Feature           | Anthropic Skills         | Octavus Skills                |
| ----------------- | ------------------------ | ----------------------------- |
| **Provider**      | Anthropic only           | Any (agnostic)                |
| **Execution**     | Anthropic's container    | Isolated sandbox              |
| **Configuration** | `agent.anthropic.skills` | `agent.skills`                |
| **Definition**    | `anthropic:` section     | `skills:` section             |
| **Use Case**      | Claude-specific features | Cross-provider code execution |

For provider-agnostic code execution, use Octavus Skills defined in the protocol's `skills:` section and enabled via `agent.skills`. See [Skills](/docs/protocol/skills) for details.

## Display Modes

Both tools and skills support display modes:

| Mode          | Behavior                        |
| ------------- | ------------------------------- |
| `hidden`      | Not shown to users              |
| `name`        | Shows the tool/skill name       |
| `description` | Shows the description (default) |
| `stream`      | Streams progress if available   |

## Full Example

```yaml
input:
  COMPANY_NAME: { type: string }
  USER_ID: { type: string, optional: true }

tools:
  get-user-account:
    description: Looking up your account
    parameters:
      userId: { type: string }

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  input: [COMPANY_NAME, USER_ID]
  tools: [get-user-account] # External tools
  agentic: true
  thinking: medium

  # Anthropic-specific options
  anthropic:
    # Provider tools (server-side)
    tools:
      web-search:
        display: description
        description: Searching the web
      code-execution:
        display: description
        description: Running code

    # Skills (knowledge packages)
    skills:
      pdf:
        type: anthropic
        display: description
        description: Processing PDF document
      xlsx:
        type: anthropic
        display: description
        description: Analyzing spreadsheet

triggers:
  user-message:
    input:
      USER_MESSAGE: { type: string }

handlers:
  user-message:
    Add message:
      block: add-message
      role: user
      prompt: user-message
      input: [USER_MESSAGE]
      display: hidden

    Respond:
      block: next-message
```

## Validation

The protocol validator enforces:

1. **Model match**: Provider options must match the model provider
   - `anthropic:` options require `anthropic/*` model
   - Using mismatched options results in a validation error

2. **Valid tool types**: Only recognized tools are accepted
   - `web-search` and `code-execution` for Anthropic

3. **Valid skill types**: Only `anthropic` or `custom` are accepted

### Error Example

```yaml
# This will fail validation
agent:
  model: openai/gpt-4o # OpenAI model
  anthropic: # Anthropic options - mismatch!
    tools:
      web-search: {}
```

Error: `"anthropic" options require an anthropic model. Current model provider: "openai"`
