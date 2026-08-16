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

| Field         | Required | Description                                                                                                                               |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `type`        | Yes      | Data type: `string`, `number`, `integer`, `boolean`, `unknown`, or a [custom type](/docs/protocol/types)                                  |
| `description` | No       | Describes what this input is for                                                                                                          |
| `optional`    | No       | If true, consumer doesn't have to provide it                                                                                              |
| `default`     | No       | Default value if not provided (defaults to `"NONE"`)                                                                                      |
| `enum`        | No       | Allowed values for a `type: string` input. Validates conditional branch literals and rejects out-of-set trigger/worker inputs at runtime. |

### Enum Inputs

A `type: string` input can declare an `enum` of allowed values. This is useful when an input selects one of a fixed set of modes and you want a mistyped branch or an unexpected value caught:

```yaml
input:
  PLAN_TIER:
    type: string
    description: The caller's plan tier
    enum: [free, pro, team]
```

Enum values pair naturally with [conditional prompt content](#conditional-prompt-content): a condition literal that isn't one of the declared values is flagged when the agent is validated, so a mistyped branch (like `{{#if PLAN_TIER == "pri"}}`) is caught before the agent runs. When an enum input is supplied as a trigger or worker input, a value outside the set (for example `"enterprise"`) is also rejected at runtime.

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

Inputs can also drive agent configuration at session creation time. The `model`, `backupModel`, `imageModel`, `temperature`, `thinking`, and `maxSteps` fields all accept variable references:

```yaml
input:
  MODEL:
    type: string
    description: The LLM model to use
  TEMPERATURE:
    type: number
    description: Override temperature
    optional: true

agent:
  model: MODEL # Resolved from session input
  temperature: TEMPERATURE # Same pattern works for thinking, maxSteps
```

Each setting accepts the natural type for that field - declare `temperature: number`, `maxSteps: integer`, `thinking: string`. See [Dynamic Model Selection](/docs/protocol/agent-config#dynamic-model-selection) and [Dynamic Configuration](/docs/protocol/agent-config#dynamic-configuration) for details.

In prompts, reference variables with `{{VARIABLE_NAME}}`:

```markdown
You are a support agent for {{COMPANY_NAME}}.
```

To use a variable in a prompt, pass it through the `input` mapping on the [agent config](/docs/protocol/agent-config#system-prompt) or [block](/docs/protocol/handlers#block-input-mapping). Variables not listed in the `input` mapping won't be interpolated - the `{{VARIABLE}}` placeholder will be preserved as-is.

> **Note:** Variables must be `UPPER_SNAKE_CASE`. Nested properties (dot notation like `{{VAR.property}}`) are not supported. Objects are serialized as JSON when interpolated.

## Conditional Prompt Content

Prompts support a block conditional so any span of content - inline text, `{{VARIABLE}}` placeholders, or `{{@path.md}}` includes - can be present only when a condition over a declared input holds. This lets the agent definition decide which instructions apply at run time, driven entirely by the inputs you supply.

```markdown
{{#if PLAN_TIER == "free"}}
{{@limits/free-tier-note.md}}
{{else}}
You have full access to premium tools.
{{/if}}

{{#if VOICE_ENABLED}}
You can take this conversation to a live voice call when it helps.
{{/if}}
```

The full form is `{{#if COND}} ... {{else if COND}} ... {{else}} ... {{/if}}` - an `if`, zero or more `else if` branches, and an optional `else`. The first branch whose condition holds renders; if none hold and there is no `else`, nothing renders. Conditionals may nest, and a branch body may contain includes and variables.

### Conditions

A condition is one of four forms - one variable, at most one comparison, one double-quoted string literal:

| Form             | Renders when                                          |
| ---------------- | ----------------------------------------------------- |
| `VAR`            | `VAR` is truthy                                       |
| `!VAR`           | `VAR` is falsy                                        |
| `VAR == "value"` | `VAR`'s string form equals `"value"` (case-sensitive) |
| `VAR != "value"` | `VAR`'s string form does not equal `"value"`          |

Boolean algebra (`and` / `or`), numeric comparisons, loops, and arithmetic are intentionally not supported - write mutually exclusive cases as separate `{{#if}}` blocks when you need them.

### Evaluation rules

- **Truthy / falsy.** A value is falsy when it is absent, `null`, boolean `false`, an empty string, or the strings `"false"` or `"0"`; everything else is truthy. Because session inputs are stringly-typed, a boolean flag that arrives as `"true"` / `"false"` behaves like the real boolean.
- **Equality.** The value's string form is compared to the literal exactly and case-sensitively, so a boolean or number input compares naturally (`STATUS == "true"`, `COUNT == "0"`). Quoted string literals are the only literal form.
- **Missing input.** A condition over an input that was not provided simply omits the span - it never errors mid-run.

A condition may reference only declared inputs (or variables/resources), resolved through the same `input` mapping as any `{{VARIABLE}}` - so list the condition's variable in the [agent config](/docs/protocol/agent-config#system-prompt) or block `input` just like a variable you interpolate. Definition validation catches an unbalanced block, a malformed condition, an undeclared condition variable, and (for an `enum` input) a literal outside the declared set.

## Resources

> **Deprecated:** Resources are deprecated and superseded by [tools](/docs/protocol/tools). Persist state with a consumer-defined tool (or MCP tool) that writes the value in your own application instead - that keeps state ownership in your app with no separate resource concept to maintain. Resources still work for now, but protocol validation emits a non-blocking deprecation warning and they may be removed in a future major version.

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
