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
  mcpServers: [figma, browser] # MCP server connections
  skills: [qr-code] # Available skills
  references: [api-guidelines] # On-demand context documents
```

## Configuration Options

| Field            | Required | Description                                                                    |
| ---------------- | -------- | ------------------------------------------------------------------------------ |
| `model`          | Yes      | Model identifier or variable reference                                         |
| `backupModel`    | No       | Backup model for automatic failover on provider errors                         |
| `system`         | Yes      | System prompt filename (without .md)                                           |
| `input`          | No       | Variables to pass to the system prompt                                         |
| `tools`          | No       | List of tools the LLM can call                                                 |
| `mcpServers`     | No       | List of MCP servers to connect (see [MCP Servers](/docs/protocol/mcp-servers)) |
| `skills`         | No       | List of Octavus skills the LLM can use                                         |
| `references`     | No       | List of references the LLM can fetch on demand                                 |
| `sandboxTimeout` | No       | Skill sandbox timeout in ms (default: 5 min, max: 1 hour)                      |
| `imageModel`     | No       | Image generation model (enables agentic image generation)                      |
| `webSearch`      | No       | Enable built-in web search tool (provider-agnostic)                            |
| `agentic`        | No       | Allow multiple tool call cycles                                                |
| `maxSteps`       | No       | Maximum agentic steps (default: 10)                                            |
| `temperature`    | No       | Model temperature (0-2)                                                        |
| `thinking`       | No       | Extended reasoning level                                                       |
| `cache`          | No       | Prompt caching mode: `auto` (default), `extended`, or `off`                    |
| `anthropic`      | No       | Anthropic-specific options (tools, skills)                                     |

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
  model: google/gemini-3-flash-preview

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

- **Multi-provider support** - Same agent works with different providers
- **A/B testing** - Test different models without protocol changes
- **User preferences** - Let users choose their preferred model

The model value is validated at runtime to ensure it's in the correct `provider/model-id` format.

> **Note**: When using dynamic models, provider-specific options (like `anthropic:`) may not apply if the model resolves to a different provider.

## Backup Model

Configure a fallback model that activates automatically when the primary model encounters a transient provider error (rate limits, outages, timeouts):

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  backupModel: openai/gpt-4o
  system: system
```

When a provider error occurs, the system retries once with the backup model. If the backup also fails, the original error is returned.

**Key behaviors:**

- Only transient provider errors trigger fallback - authentication and validation errors are not retried
- Provider-specific options (like `anthropic:`) are only forwarded to the backup model if it uses the same provider
- For streaming responses, fallback only occurs if no content has been sent to the client yet

Like `model`, `backupModel` supports variable references:

```yaml
input:
  BACKUP_MODEL:
    type: string
    description: Fallback model for provider errors

agent:
  model: anthropic/claude-sonnet-4-5
  backupModel: BACKUP_MODEL
  system: system
```

> **Tip**: Use a different provider for your backup model (e.g., primary on Anthropic, backup on OpenAI) to maximize resilience against single-provider outages.

## System Prompt

The system prompt sets the agent's persona and instructions. The `input` field controls which variables are available to the prompt - only variables listed in `input` are interpolated.

```yaml
agent:
  system: system # Uses prompts/system.md
  input:
    - COMPANY_NAME
    - PRODUCT_NAME
```

Variables in `input` can come from `protocol.input`, `protocol.resources`, or `protocol.variables`.

### Input Mapping Formats

```yaml
# Array format (same name)
input:
  - COMPANY_NAME
  - PRODUCT_NAME

# Array format (rename)
input:
  - CONTEXT: CONVERSATION_SUMMARY  # Prompt sees CONTEXT, value comes from CONVERSATION_SUMMARY

# Object format (rename)
input:
  CONTEXT: CONVERSATION_SUMMARY
```

The left side (label) is what the prompt sees. The right side (source) is where the value comes from.

### Example

`prompts/system.md`:

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

| Level    | Use Case            |
| -------- | ------------------- |
| `low`    | Simple reasoning    |
| `medium` | Moderate complexity |
| `high`   | Complex analysis    |

Thinking content streams to the UI and can be displayed to users.

### How levels are applied

Each provider translates `thinking` into its own reasoning controls:

| Provider                                                                   | Level mapping                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Anthropic 4.6+ (`claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`) | Adaptive thinking - the model decides how much to reason, guided by `effort: low / medium / high` |
| Anthropic older (4.5 and earlier)                                          | Fixed token budgets: `low` ~5,000, `medium` ~10,000, `high` ~20,000                               |
| OpenAI (GPT-5.x, o-series)                                                 | `reasoningEffort: low / medium / high`                                                            |
| Google (Gemini 3.x)                                                        | `thinkingLevel: low / high` (`medium` rounds up to `high`)                                        |
| Google (Gemini 1.x / 2.x)                                                  | Token budgets: `low` 1,024, `medium` 8,192, `high` 24,576                                         |
| OpenRouter                                                                 | Unified `reasoning.max_tokens` (translated upstream)                                              |
| Vercel AI Gateway                                                          | Forwards the underlying provider's options                                                        |

## Prompt Caching

Providers charge less for tokens served from their prompt cache (often 10% of the uncached rate). Octavus exposes a single `cache` field that picks the right retention policy per provider, so the stable prefix of your agent - tools, system prompt, and historical messages - gets billed at the cache-read rate on repeat requests.

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  cache: auto # auto (default) | extended | off
```

| Mode       | Behavior                                                                      | When to use                                                                                             |
| ---------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `auto`     | Short-TTL caching. Default when omitted.                                      | Most agents. Free on all supported providers and pays for itself within the same session.               |
| `extended` | Long-TTL caching. Trades a higher cache-write cost for much longer residency. | Agents triggered with gaps (daily reports, on-call assistants) where the prefix is reused across hours. |
| `off`      | No opt-in caching emitted.                                                    | When you explicitly want to skip caching - e.g. debugging a non-deterministic prefix.                   |

### Per-provider behavior

The `cache` field is provider-agnostic at the protocol level - each provider translates it into its own cache retention policy:

| Provider  | `auto` TTL                | `extended` TTL |
| --------- | ------------------------- | -------------- |
| Anthropic | 5 minutes                 | 1 hour         |
| OpenAI    | in-memory (~5–10 minutes) | 24 hours       |
| Google    | Implicit (Gemini 2.5+)    | Implicit       |

On `off`, Octavus emits no explicit cache options. Providers that auto-cache (OpenAI on prefixes ≥ 1,024 tokens, Gemini 2.5+) may still cache transparently - `off` just disables Octavus's opt-in behavior.

### Threads don't inherit

Named threads (created with `start-thread`) read their own `cache` field independently - they **do not** inherit the agent's cache value:

```yaml
agent:
  cache: extended # 1-hour TTL on the main thread

handlers:
  summarize:
    Start summary:
      block: start-thread
      thread: summary
      # No cache field → defaults to 'auto' (5-minute TTL), NOT 'extended'
      system: summary-system
```

This is intentional: named threads are often used for short, one-shot work (summarization, classification) where the long TTL would be wasted. Set `cache` explicitly on `start-thread` when you do want it.

### Cost trade-offs

- **Cache reads** are always much cheaper than uncached input on any provider - caching is effectively free if your prefix is stable.
- **Cache writes** on Anthropic cost ~1.25× input for `auto` and 2× input for `extended`. OpenAI and Google don't charge separately for cache writes.
- Use `extended` only when the same prefix is genuinely reused across sessions that span hours; otherwise the higher write cost dominates the savings.

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

## References

Enable on-demand context loading via reference documents:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  references: [api-guidelines, error-codes]
  agentic: true
```

References are markdown files stored in the agent's `references/` directory. When enabled, the LLM can list available references and read their content using `octavus_reference_list` and `octavus_reference_read` tools.

See [References](/docs/protocol/references) for full documentation.

## Image Generation

Enable the LLM to generate images autonomously:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  imageModel: google/gemini-2.5-flash-image
  agentic: true
```

When `imageModel` is configured, the `octavus_generate_image` tool becomes available. The LLM can decide when to generate images based on user requests. The tool supports both text-to-image generation and image editing/transformation using reference images.

### Supported Image Providers

| Provider | Model Types                             | Examples                                                  |
| -------- | --------------------------------------- | --------------------------------------------------------- |
| OpenAI   | Dedicated image models                  | `gpt-image-1`                                             |
| Google   | Gemini native (contains "image")        | `gemini-2.5-flash-image`, `gemini-3-flash-image-generate` |
| Google   | Imagen dedicated (starts with "imagen") | `imagen-4.0-generate-001`                                 |

> **Note**: Google has two image generation approaches. Gemini "native" models (containing "image" in the ID) generate images using the language model API with `responseModalities`. Imagen models (starting with "imagen") use a dedicated image generation API.

### Image Sizes

The tool supports three image sizes:

- `1024x1024` (default) - Square
- `1792x1024` - Landscape (16:9)
- `1024x1792` - Portrait (9:16)

### Image Editing with Reference Images

Both the agentic tool and the `generate-image` block support reference images for editing and transformation. When reference images are provided, the prompt describes how to modify or use those images.

| Provider | Models                           | Reference Image Support |
| -------- | -------------------------------- | ----------------------- |
| OpenAI   | `gpt-image-1`                    | Yes                     |
| Google   | Gemini native (`gemini-*-image`) | Yes                     |
| Google   | Imagen (`imagen-*`)              | No                      |

### Agentic vs Deterministic

Use `imageModel` in agent config when:

- The LLM should decide when to generate or edit images
- Users ask for images in natural language

Use `generate-image` block (see [Handlers](/docs/protocol/handlers#generate-image)) when:

- You want explicit control over image generation or editing
- Building prompt engineering pipelines
- Images are generated at specific handler steps

## Web Search

Enable the LLM to search the web for current information:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  webSearch: true
  agentic: true
```

When `webSearch` is enabled, the `octavus_web_search` tool becomes available. The LLM can decide when to search the web based on the conversation. Search results include source URLs that are emitted as citations in the UI.

This is a **provider-agnostic** built-in tool - it works with any LLM provider (Anthropic, Google, OpenAI, etc.). For Anthropic's own web search implementation, see [Provider Options](/docs/protocol/provider-options).

Use cases:

- Current events and real-time data
- Fact verification and documentation lookups
- Any information that may have changed since the model's training

## TODO List

Enable the LLM to maintain a structured task list while it works:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  todoList: true
  agentic: true
```

When `todoList` is enabled, the `octavus_todo_write` tool becomes available. The LLM creates and updates a list of items - each with `id`, `content`, and `status` (`pending`, `in_progress`, `completed`, `cancelled`) - and the platform emits a `todo-update` stream event with the resolved snapshot. The Client SDK accumulates updates into a single `UITodoPart` per assistant message, so consumers render an evolving "Plan" card without managing state themselves.

The list persists across messages: the LLM can use `merge=true` to update items by id (sending only the changed fields), or `merge=false` to replace the list entirely.

Use cases:

- Multi-step tasks where the user benefits from seeing progress
- Long-running agentic loops that should communicate intent
- Workflows where the agent plans before acting

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

Provider options are validated against the model - using `anthropic:` with a non-Anthropic model will fail validation.

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
      backupModel: openai/gpt-4o # Failover model
      thinking: low # Different thinking
      cache: off # Different cache mode (does not inherit from agent)
      maxSteps: 1 # Limit tool calls
      system: escalation-summary # Different prompt
      mcpServers: [figma, browser] # Thread-specific MCP servers
      skills: [data-analysis] # Thread-specific skills
      references: [escalation-policy] # Thread-specific references
      imageModel: google/gemini-2.5-flash-image # Thread-specific image model
      webSearch: true # Thread-specific web search
      todoList: true # Thread-specific task list
```

Each thread can have its own model, backup model, cache mode, MCP servers, skills, references, image model, web search setting, and task list setting. Skills must be defined in the protocol's `skills:` section. References must exist in the agent's `references/` directory. Workers use this same pattern since they don't have a global `agent:` section.

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

mcpServers:
  figma:
    description: Figma design tool integration
    source: remote
    display: description

skills:
  qr-code:
    display: description
    description: Generating QR codes

agent:
  model: anthropic/claude-sonnet-4-5
  backupModel: openai/gpt-4o
  system: system
  input:
    - COMPANY_NAME
    - PRODUCT_NAME
  tools:
    - get-user-account
    - search-docs
    - create-support-ticket
  mcpServers: [figma] # MCP server connections
  skills: [qr-code] # Octavus skills
  references: [support-policies] # On-demand context
  webSearch: true # Built-in web search
  todoList: true # Structured task tracking
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
