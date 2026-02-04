---
title: Workers
description: Defining worker agents for background and task-based execution.
---

# Workers

Workers are agents designed for task-based execution. Unlike interactive agents that handle multi-turn conversations, workers execute a sequence of steps and return an output value.

## When to Use Workers

Workers are ideal for:

- **Background processing** — Long-running tasks that don't need conversation
- **Composable tasks** — Reusable units of work called by other agents
- **Pipelines** — Multi-step processing with structured output
- **Parallel execution** — Tasks that can run independently

Use interactive agents instead when:

- **Conversation is needed** — Multi-turn dialogue with users
- **Persistence matters** — State should survive across interactions
- **Session context** — User context needs to persist

## Worker vs Interactive

| Aspect     | Interactive                        | Worker                        |
| ---------- | ---------------------------------- | ----------------------------- |
| Structure  | `triggers` + `handlers` + `agent`  | `steps` + `output`            |
| LLM Config | Global `agent:` section            | Per-thread via `start-thread` |
| Invocation | Fire a named trigger               | Direct execution with input   |
| Session    | Persists across triggers (24h TTL) | Single execution              |
| Result     | Streaming chat                     | Streaming + output value      |

## Protocol Structure

Workers use a simpler protocol structure than interactive agents:

```yaml
# Input schema - provided when worker is executed
input:
  TOPIC:
    type: string
    description: Topic to research
  DEPTH:
    type: string
    optional: true
    default: medium

# Variables for intermediate results
variables:
  RESEARCH_DATA:
    type: string
  ANALYSIS:
    type: string
    description: Final analysis result

# Tools available to the worker
tools:
  web-search:
    description: Search the web
    parameters:
      query: { type: string }

# Sequential execution steps
steps:
  Start research:
    block: start-thread
    thread: research
    model: anthropic/claude-sonnet-4-5
    system: research-system
    input: [TOPIC, DEPTH]
    tools: [web-search]
    maxSteps: 5

  Add research request:
    block: add-message
    thread: research
    role: user
    prompt: research-prompt
    input: [TOPIC, DEPTH]

  Generate research:
    block: next-message
    thread: research
    output: RESEARCH_DATA

  Start analysis:
    block: start-thread
    thread: analysis
    model: anthropic/claude-sonnet-4-5
    system: analysis-system

  Add analysis request:
    block: add-message
    thread: analysis
    role: user
    prompt: analysis-prompt
    input: [RESEARCH_DATA]

  Generate analysis:
    block: next-message
    thread: analysis
    output: ANALYSIS

# Output variable - the worker's return value
output: ANALYSIS
```

## settings.json

Workers are identified by the `format` field:

```json
{
  "slug": "research-assistant",
  "name": "Research Assistant",
  "description": "Researches topics and returns structured analysis",
  "format": "worker"
}
```

## Key Differences

### No Global Agent Config

Interactive agents have a global `agent:` section that configures a main thread. Workers don't have this — every thread must be explicitly created via `start-thread`:

```yaml
# Interactive agent: Global config
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  tools: [tool-a, tool-b]

# Worker: Each thread configured independently
steps:
  Start thread A:
    block: start-thread
    thread: research
    model: anthropic/claude-sonnet-4-5
    tools: [tool-a]

  Start thread B:
    block: start-thread
    thread: analysis
    model: openai/gpt-4o
    tools: [tool-b]
```

This gives workers flexibility to use different models, tools, and settings at different stages.

### Steps Instead of Handlers

Workers use `steps:` instead of `handlers:`. Steps execute sequentially, like handler blocks:

```yaml
# Interactive: Handlers respond to triggers
handlers:
  user-message:
    Add message:
      block: add-message
      # ...

# Worker: Steps execute in sequence
steps:
  Add message:
    block: add-message
    # ...
```

### Output Value

Workers can return an output value to the caller:

```yaml
variables:
  RESULT:
    type: string

steps:
  # ... steps that populate RESULT ...

output: RESULT # Return this variable's value
```

The `output` field references a variable declared in `variables:`. If omitted, the worker completes without returning a value.

## Available Blocks

Workers support the same blocks as handlers:

| Block              | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `start-thread`     | Create a named thread with LLM configuration |
| `add-message`      | Add a message to a thread                    |
| `next-message`     | Generate LLM response                        |
| `tool-call`        | Call a tool deterministically                |
| `set-resource`     | Update a resource value                      |
| `serialize-thread` | Convert thread to text                       |
| `generate-image`   | Generate an image from a prompt variable     |

### start-thread (Required for LLM)

Every thread must be initialized with `start-thread` before using `next-message`:

```yaml
steps:
  Start research:
    block: start-thread
    thread: research
    model: anthropic/claude-sonnet-4-5
    system: research-system
    input: [TOPIC]
    tools: [web-search]
    thinking: medium
    maxSteps: 5
```

All LLM configuration goes here:

| Field         | Description                                       |
| ------------- | ------------------------------------------------- |
| `thread`      | Thread name (defaults to block name)              |
| `model`       | LLM model to use                                  |
| `system`      | System prompt filename (required)                 |
| `input`       | Variables for system prompt                       |
| `tools`       | Tools available in this thread                    |
| `workers`     | Workers available to this thread (as LLM tools)   |
| `imageModel`  | Image generation model                            |
| `thinking`    | Extended reasoning level                          |
| `temperature` | Model temperature                                 |
| `maxSteps`    | Maximum tool call cycles (enables agentic if > 1) |

## Simple Example

A worker that generates a title from a summary:

```yaml
# Input
input:
  CONVERSATION_SUMMARY:
    type: string
    description: Summary to generate a title for

# Variables
variables:
  TITLE:
    type: string
    description: The generated title

# Steps
steps:
  Start title thread:
    block: start-thread
    thread: title-gen
    model: anthropic/claude-sonnet-4-5
    system: title-system

  Add title request:
    block: add-message
    thread: title-gen
    role: user
    prompt: title-request
    input: [CONVERSATION_SUMMARY]

  Generate title:
    block: next-message
    thread: title-gen
    output: TITLE
    display: stream

# Output
output: TITLE
```

## Advanced Example

A worker with multiple threads, tools, and agentic behavior:

```yaml
input:
  USER_MESSAGE:
    type: string
    description: The user's message to respond to
  USER_ID:
    type: string
    description: User ID for account lookups
    optional: true

tools:
  get-user-account:
    description: Looking up account information
    parameters:
      userId: { type: string }
  create-support-ticket:
    description: Creating a support ticket
    parameters:
      summary: { type: string }
      priority: { type: string }

variables:
  ASSISTANT_RESPONSE:
    type: string
  CHAT_TRANSCRIPT:
    type: string
  CONVERSATION_SUMMARY:
    type: string

steps:
  # Thread 1: Chat with agentic tool calling
  Start chat thread:
    block: start-thread
    thread: chat
    model: anthropic/claude-sonnet-4-5
    system: chat-system
    input: [USER_ID]
    tools: [get-user-account, create-support-ticket]
    thinking: medium
    maxSteps: 5

  Add user message:
    block: add-message
    thread: chat
    role: user
    prompt: user-message
    input: [USER_MESSAGE]

  Generate response:
    block: next-message
    thread: chat
    output: ASSISTANT_RESPONSE
    display: stream

  # Serialize for summary
  Save conversation:
    block: serialize-thread
    thread: chat
    output: CHAT_TRANSCRIPT

  # Thread 2: Summary generation
  Start summary thread:
    block: start-thread
    thread: summary
    model: anthropic/claude-sonnet-4-5
    system: summary-system
    thinking: low

  Add summary request:
    block: add-message
    thread: summary
    role: user
    prompt: summary-request
    input: [CHAT_TRANSCRIPT]

  Generate summary:
    block: next-message
    thread: summary
    output: CONVERSATION_SUMMARY
    display: stream

output: CONVERSATION_SUMMARY
```

## Tool Handling

Workers support the same tool handling as interactive agents:

- **Server tools** — Handled by tool handlers you provide
- **Client tools** — Pause execution, return tool request to caller

```typescript
const events = client.workers.execute(
  agentId,
  { TOPIC: 'AI safety' },
  {
    tools: {
      'web-search': async (args) => {
        return await searchWeb(args.query);
      },
    },
  },
);
```

See [Server SDK Workers](/docs/server-sdk/workers) for tool handling details.

## Stream Events

Workers emit the same events as interactive agents, plus worker-specific events:

| Event           | Description                        |
| --------------- | ---------------------------------- |
| `worker-start`  | Worker execution begins            |
| `worker-result` | Worker completes (includes output) |

All standard events (text-delta, tool calls, etc.) are also emitted.

## Calling Workers from Interactive Agents

Interactive agents can call workers in two ways:

1. **Deterministically** — Using the `run-worker` block
2. **Agentically** — LLM calls worker as a tool

### Worker Declaration

First, declare workers in your interactive agent's protocol:

```yaml
workers:
  generate-title:
    description: Generating conversation title
    display: description
  research-assistant:
    description: Researching topic
    display: stream
    tools:
      search: web-search # Map worker tool → parent tool
```

### run-worker Block

Call a worker deterministically from a handler:

```yaml
handlers:
  request-human:
    Generate title:
      block: run-worker
      worker: generate-title
      input:
        CONVERSATION_SUMMARY: SUMMARY
      output: CONVERSATION_TITLE
```

### LLM Tool Invocation

Make workers available to the LLM:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  workers: [generate-title, research-assistant]
  agentic: true
```

The LLM can then call workers as tools during conversation.

### Display Modes

Control how worker execution appears to users:

| Mode          | Behavior                          |
| ------------- | --------------------------------- |
| `hidden`      | Worker runs silently              |
| `name`        | Shows worker name                 |
| `description` | Shows description text            |
| `stream`      | Streams all worker events to user |

### Tool Mapping

Map parent tools to worker tools when the worker needs access to your tool handlers:

```yaml
workers:
  research-assistant:
    description: Research topics
    tools:
      search: web-search # Worker's "search" → parent's "web-search"
```

When the worker calls its `search` tool, your `web-search` handler executes.

## Next Steps

- [Server SDK Workers](/docs/server-sdk/workers) — Executing workers from code
- [Handlers](/docs/protocol/handlers) — Block reference for steps
- [Agent Config](/docs/protocol/agent-config) — Model and settings
