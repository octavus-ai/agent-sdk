---
title: Input & Resources
description: Defining agent inputs and persistent resources.
---

# Input & Resources

Inputs are provided when creating a session. Resources are persistent state the agent can read and write.

## Input Variables

Define inputs that consumers must (or may) provide:

```yaml
input:
  # Required input
  COMPANY_NAME:
    type: string
    description: The company name to use in responses

  # Required input with description
  PRODUCT_NAME:
    type: string
    description: Product being supported

  # Optional input (defaults to "NONE")
  SUPPORT_POLICIES:
    type: string
    description: Company policies for support
    optional: true

  # Optional input with custom default
  USER_ID:
    type: string
    description: Current user's ID
    optional: true
    default: ''
```

### Input Definition

| Field         | Required | Description                                                                                              |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `type`        | Yes      | Data type: `string`, `number`, `integer`, `boolean`, `unknown`, or a [custom type](/docs/protocol/types) |
| `description` | No       | Describes what this input is for                                                                         |
| `optional`    | No       | If true, consumer doesn't have to provide it                                                             |
| `default`     | No       | Default value if not provided (defaults to `"NONE"`)                                                     |

### Using Inputs

When creating a session, pass input values:

```typescript
const sessionId = await client.agentSessions.create('support-chat', {
  COMPANY_NAME: 'Acme Corp',
  PRODUCT_NAME: 'Widget Pro',
  SUPPORT_POLICIES: 'Refunds within 30 days...',
  // USER_ID is optional, not provided
});
```

Inputs can also be used for [dynamic model selection](/docs/protocol/agent-config#dynamic-model-selection):

```yaml
input:
  MODEL:
    type: string
    description: The LLM model to use

agent:
  model: MODEL # Resolved from session input
```

In prompts, reference with `{{INPUT_NAME}}`:

```markdown
You are a support agent for {{COMPANY_NAME}}.
```

> **Note:** Variables must be `UPPER_SNAKE_CASE`. Nested properties (dot notation like `{{VAR.property}}`) are not supported. Objects are serialized as JSON when interpolated.

## Resources

Resources are persistent state that:

- Survive across triggers
- Can be read and written by the agent
- Are synced to the consumer's application

```yaml
resources:
  # String resource with default
  CONVERSATION_SUMMARY:
    type: string
    description: Running summary of the conversation
    default: ''

  # Resource with unknown type (for complex data)
  USER_CONTEXT:
    type: unknown
    description: Cached user information
    default: {}

  # Read-only resource (agent can read but not write)
  SYSTEM_CONFIG:
    type: unknown
    description: System configuration
    readonly: true
    default:
      maxRetries: 3
      timeout: 30000
```

### Resource Definition

| Field         | Required | Description                                                                                              |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `type`        | Yes      | Data type: `string`, `number`, `integer`, `boolean`, `unknown`, or a [custom type](/docs/protocol/types) |
| `description` | No       | Describes the resource purpose                                                                           |
| `default`     | No       | Initial value                                                                                            |
| `readonly`    | No       | If true, agent cannot write to it                                                                        |

### Writing Resources

Use the `set-resource` block in handlers:

```yaml
handlers:
  request-human:
    # ... generate summary ...

    Save summary:
      block: set-resource
      resource: CONVERSATION_SUMMARY
      value: SUMMARY # Variable containing the value
```

### Resource Events

When a resource is updated, the client SDK receives a `resource-update` event:

```typescript
useOctavusChat({
  onResourceUpdate: (name, value) => {
    if (name === 'CONVERSATION_SUMMARY') {
      console.log('Summary updated:', value);
    }
  },
});
```

## Variables

Variables are internal state managed by block outputs. They persist across triggers but are not synced to the consumer (unlike resources).

```yaml
variables:
  SUMMARY:
    type: string
    description: Generated summary text
  TICKET:
    type: unknown
    description: Ticket creation result
  CONVERSATION_TEXT:
    type: string
    description: Serialized conversation
```

### Variable Definition

| Field         | Required | Description                                                                                              |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `type`        | Yes      | Data type: `string`, `number`, `integer`, `boolean`, `unknown`, or a [custom type](/docs/protocol/types) |
| `description` | No       | Describes what this variable stores                                                                      |
| `default`     | No       | Initial value                                                                                            |

### Using Variables

Set variables as output from blocks:

```yaml
handlers:
  request-human:
    Serialize conversation:
      block: serialize-thread
      format: markdown
      output: CONVERSATION_TEXT # Stores result in variable

    Generate summary:
      block: next-message
      output: SUMMARY # LLM output stored in variable

    Create ticket:
      block: tool-call
      tool: create-support-ticket
      input:
        summary: SUMMARY # Use variable as input
      output: TICKET
```

## Scoping

| Type        | Scope   | Persistence              | Synced to Consumer  |
| ----------- | ------- | ------------------------ | ------------------- |
| `input`     | Session | Immutable                | Yes (at creation)   |
| `resources` | Session | Persists across triggers | Yes (via callbacks) |
| `variables` | Session | Persists across triggers | No (internal only)  |
