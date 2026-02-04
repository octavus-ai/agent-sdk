---
title: Agent Config
description: Configuring the agent model and behavior.
---

# Agent Config

The `agent` section configures the LLM model, system prompt, tools, and behavior.

## Basic Configuration

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system # References prompts/system.md
  tools: [get-user-account] # Available tools
  skills: [qr-code] # Available skills
```

## Configuration Options

| Field         | Required | Description                                               |
| ------------- | -------- | --------------------------------------------------------- |
| `model`       | Yes      | Model identifier or variable reference                    |
| `system`      | Yes      | System prompt filename (without .md)                      |
| `input`       | No       | Variables to interpolate in system prompt                 |
| `tools`       | No       | List of tools the LLM can call                            |
| `skills`      | No       | List of Octavus skills the LLM can use                    |
| `imageModel`  | No       | Image generation model (enables agentic image generation) |
| `agentic`     | No       | Allow multiple tool call cycles                           |
| `maxSteps`    | No       | Maximum agentic steps (default: 10)                       |
| `temperature` | No       | Model temperature (0-2)                                   |
| `thinking`    | No       | Extended reasoning level                                  |
| `anthropic`   | No       | Anthropic-specific options (tools, skills)                |

## Models

Specify models in `provider/model-id` format. Any model supported by the provider's SDK will work.

### Supported Providers

| Provider  | Format                 | Examples                                                             |
| --------- | ---------------------- | -------------------------------------------------------------------- |
| Anthropic | `anthropic/{model-id}` | `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`           |
| Google    | `google/{model-id}`    | `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-flash` |
| OpenAI    | `openai/{model-id}`    | `gpt-5`, `gpt-4o`, `o4-mini`, `o3`, `o3-mini`, `o1`                  |

### Examples

```yaml
# Anthropic Claude 4.5
agent:
  model: anthropic/claude-sonnet-4-5

# Google Gemini 3
agent:
  model: google/gemini-3-flash

# OpenAI GPT-5
agent:
  model: openai/gpt-5

# OpenAI reasoning models
agent:
  model: openai/o3-mini
```

> **Note**: Model IDs are passed directly to the provider SDK. Check the provider's documentation for the latest available models.

### Dynamic Model Selection

The model field can also reference an input variable, allowing consumers to choose the model when creating a session:

```yaml
input:
  MODEL:
    type: string
    description: The LLM model to use

agent:
  model: MODEL # Resolved from session input
  system: system
```

When creating a session, pass the model:

```typescript
const sessionId = await client.agentSessions.create('my-agent', {
  MODEL: 'anthropic/claude-sonnet-4-5',
});
```

This enables:

- **Multi-provider support** — Same agent works with different providers
- **A/B testing** — Test different models without protocol changes
- **User preferences** — Let users choose their preferred model

The model value is validated at runtime to ensure it's in the correct `provider/model-id` format.

> **Note**: When using dynamic models, provider-specific options (like `anthropic:`) may not apply if the model resolves to a different provider.

## System Prompt

The system prompt sets the agent's persona and instructions:

```yaml
agent:
  system: system # Uses prompts/system.md
  input:
    - COMPANY_NAME
    - PRODUCT_NAME
```

Example `prompts/system.md`:

```markdown
You are a friendly support agent for {{COMPANY_NAME}}.

## Your Role

Help users with questions about {{PRODUCT_NAME}}.

## Guidelines

- Be helpful and professional
- If you can't help, offer to escalate
- Never share internal information
```

## Agentic Mode

Enable multi-step tool calling:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  tools: [get-user-account, search-docs, create-ticket]
  agentic: true # LLM can call multiple tools
  maxSteps: 10 # Limit cycles to prevent runaway
```

**How it works:**

1. LLM receives user message
2. LLM decides to call a tool
3. Tool executes, result returned to LLM
4. LLM decides if more tools needed
5. Repeat until LLM responds or maxSteps reached

## Extended Thinking

Enable extended reasoning for complex tasks:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  thinking: medium # low | medium | high
```

| Level    | Token Budget | Use Case            |
| -------- | ------------ | ------------------- |
| `low`    | ~5,000       | Simple reasoning    |
| `medium` | ~10,000      | Moderate complexity |
| `high`   | ~20,000      | Complex analysis    |

Thinking content streams to the UI and can be displayed to users.

## Skills

Enable Octavus skills for code execution and file generation:

```yaml
skills:
  qr-code:
    display: description
    description: Generating QR codes

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  skills: [qr-code] # Enable skills
  agentic: true
```

Skills provide provider-agnostic code execution in isolated sandboxes. When enabled, the LLM can execute Python/Bash code, run skill scripts, and generate files.

See [Skills](/docs/protocol/skills) for full documentation.

## Image Generation

Enable the LLM to generate images autonomously:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  imageModel: google/gemini-2.5-flash-image
  agentic: true
```

When `imageModel` is configured, the `octavus_generate_image` tool becomes available. The LLM can decide when to generate images based on user requests.

### Supported Image Providers

| Provider | Model Types                             | Examples                                                  |
| -------- | --------------------------------------- | --------------------------------------------------------- |
| OpenAI   | Dedicated image models                  | `gpt-image-1`                                             |
| Google   | Gemini native (contains "image")        | `gemini-2.5-flash-image`, `gemini-3-flash-image-generate` |
| Google   | Imagen dedicated (starts with "imagen") | `imagen-4.0-generate-001`                                 |

> **Note**: Google has two image generation approaches. Gemini "native" models (containing "image" in the ID) generate images using the language model API with `responseModalities`. Imagen models (starting with "imagen") use a dedicated image generation API.

### Image Sizes

The tool supports three image sizes:

- `1024x1024` (default) — Square
- `1792x1024` — Landscape (16:9)
- `1024x1792` — Portrait (9:16)

### Agentic vs Deterministic

Use `imageModel` in agent config when:

- The LLM should decide when to generate images
- Users ask for images in natural language

Use `generate-image` block (see [Handlers](/docs/protocol/handlers#generate-image)) when:

- You want explicit control over image generation
- Building prompt engineering pipelines
- Images are generated at specific handler steps

## Temperature

Control response randomness:

```yaml
agent:
  model: openai/gpt-4o
  temperature: 0.7 # 0 = deterministic, 2 = creative
```

**Guidelines:**

- `0 - 0.3`: Factual, consistent responses
- `0.4 - 0.7`: Balanced (good default)
- `0.8 - 1.2`: Creative, varied responses
- `> 1.2`: Very creative (may be inconsistent)

## Provider Options

Enable provider-specific features like Anthropic's built-in tools and skills:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  anthropic:
    tools:
      web-search:
        display: description
        description: Searching the web
    skills:
      pdf:
        type: anthropic
        description: Processing PDF
```

Provider options are validated against the model—using `anthropic:` with a non-Anthropic model will fail validation.

See [Provider Options](/docs/protocol/provider-options) for full documentation.

## Thread-Specific Config

Override config for named threads:

```yaml
handlers:
  request-human:
    Start summary thread:
      block: start-thread
      thread: summary
      model: anthropic/claude-sonnet-4-5 # Different model
      thinking: low # Different thinking
      maxSteps: 1 # Limit tool calls
      system: escalation-summary # Different prompt
```

## Full Example

```yaml
input:
  COMPANY_NAME: { type: string }
  PRODUCT_NAME: { type: string }
  USER_ID: { type: string, optional: true }

resources:
  CONVERSATION_SUMMARY:
    type: string
    default: ''

tools:
  get-user-account:
    description: Look up user account
    parameters:
      userId: { type: string }

  search-docs:
    description: Search help documentation
    parameters:
      query: { type: string }

  create-support-ticket:
    description: Create a support ticket
    parameters:
      summary: { type: string }
      priority: { type: string } # low, medium, high

skills:
  qr-code:
    display: description
    description: Generating QR codes

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  input:
    - COMPANY_NAME
    - PRODUCT_NAME
  tools:
    - get-user-account
    - search-docs
    - create-support-ticket
  skills: [qr-code] # Octavus skills
  agentic: true
  maxSteps: 10
  thinking: medium
  # Anthropic-specific options
  anthropic:
    tools:
      web-search:
        display: description
        description: Searching the web
    skills:
      pdf:
        type: anthropic
        description: Processing PDF

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
