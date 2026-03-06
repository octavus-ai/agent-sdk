---
title: Tools
description: Defining external tools implemented in your backend.
---

# Tools

Tools extend what agents can do. Octavus supports multiple types:

1. **External Tools** — Defined in the protocol, implemented in your backend (this page)
2. **Built-in Tools** — Provider-agnostic tools managed by Octavus (web search, image generation)
3. **Provider Tools** — Provider-specific tools executed by the provider (e.g., Anthropic's code execution)
4. **Skills** — Code execution and knowledge packages (see [Skills](/docs/protocol/skills))

This page covers external tools. Built-in tools are enabled via agent config — see [Web Search](/docs/protocol/agent-config#web-search) and [Image Generation](/docs/protocol/agent-config#image-generation). For provider-specific tools, see [Provider Options](/docs/protocol/provider-options). For code execution, see [Skills](/docs/protocol/skills).

## External Tools

External tools are defined in the `tools:` section and implemented in your backend.

## Defining Tools

```yaml
tools:
  get-user-account:
    description: Looking up your account information
    display: description
    parameters:
      userId:
        type: string
        description: The user ID to look up
```

### Tool Fields

| Field         | Required | Description                                                  |
| ------------- | -------- | ------------------------------------------------------------ |
| `description` | Yes      | What the tool does (shown to LLM and optionally user)        |
| `display`     | No       | How to show in UI: `hidden`, `name`, `description`, `stream` |
| `parameters`  | No       | Input parameters the tool accepts                            |

### Display Modes

| Mode          | Behavior                                    |
| ------------- | ------------------------------------------- |
| `hidden`      | Tool runs silently, user doesn't see it     |
| `name`        | Shows tool name while executing             |
| `description` | Shows description while executing (default) |
| `stream`      | Streams tool progress if available          |

## Parameters

Tool calls are always objects where each parameter name maps to a value. The LLM generates: `{ param1: value1, param2: value2, ... }`

### Parameter Fields

| Field         | Required | Description                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `type`        | Yes      | Data type: `string`, `number`, `integer`, `boolean`, `unknown`, or a custom type |
| `description` | No       | Describes what this parameter is for                                             |
| `optional`    | No       | If true, parameter is not required (default: false)                              |

> **Tip**: You can use [custom types](/docs/protocol/types) for complex parameters like `type: ProductFilter` or `type: SearchOptions`.

### Array Parameters

For array parameters, define a [top-level array type](/docs/protocol/types#top-level-array-types) and use it:

```yaml
types:
  CartItem:
    productId:
      type: string
    quantity:
      type: integer

  CartItemList:
    type: array
    items:
      type: CartItem

tools:
  add-to-cart:
    description: Add items to cart
    parameters:
      items:
        type: CartItemList
        description: Items to add
```

The tool receives: `{ items: [{ productId: "...", quantity: 1 }, ...] }`

### Optional Parameters

Parameters are **required by default**. Use `optional: true` to make a parameter optional:

```yaml
tools:
  search-products:
    description: Search the product catalog
    parameters:
      query:
        type: string
        description: Search query

      category:
        type: string
        description: Filter by category
        optional: true

      maxPrice:
        type: number
        description: Maximum price filter
        optional: true

      inStock:
        type: boolean
        description: Only show in-stock items
        optional: true
```

## Making Tools Available

Tools defined in `tools:` are available. To make them usable by the LLM, add them to `agent.tools`:

```yaml
tools:
  get-user-account:
    description: Look up user account
    parameters:
      userId: { type: string }

  create-support-ticket:
    description: Create a support ticket
    parameters:
      summary: { type: string }
      priority: { type: string } # low, medium, high, urgent

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  tools:
    - get-user-account
    - create-support-ticket # LLM can decide when to call these
  agentic: true
```

## Tool Invocation Modes

### LLM-Decided (Agentic)

The LLM decides when to call tools based on the conversation:

```yaml
agent:
  tools: [get-user-account, create-support-ticket]
  agentic: true # Allow multiple tool calls
  maxSteps: 10 # Max tool call cycles
```

### Deterministic (Block-Based)

Force tool calls at specific points in the handler:

```yaml
handlers:
  request-human:
    # Always create a ticket when escalating
    Create support ticket:
      block: tool-call
      tool: create-support-ticket
      input:
        summary: SUMMARY # From variable
        priority: medium # Literal value
      output: TICKET # Store result
```

## Tool Results

### In Prompts

Tool results are stored in variables. Reference the variable in prompts:

```markdown
<!-- prompts/ticket-directive.md -->

A support ticket has been created:
{{TICKET}}

Let the user know their ticket has been created.
```

When the `TICKET` variable contains an object, it's automatically serialized as JSON in the prompt:

```
A support ticket has been created:
{
  "ticketId": "TKT-123ABC",
  "estimatedResponse": "24 hours"
}

Let the user know their ticket has been created.
```

> **Note**: Variables use `{{VARIABLE_NAME}}` syntax with `UPPERCASE_SNAKE_CASE`. Dot notation (like `{{TICKET.ticketId}}`) is not supported. Objects are automatically JSON-serialized.

### In Variables

Store tool results for later use:

```yaml
handlers:
  request-human:
    Get account:
      block: tool-call
      tool: get-user-account
      input:
        userId: USER_ID
      output: ACCOUNT # Result stored here

    Create ticket:
      block: tool-call
      tool: create-support-ticket
      input:
        summary: SUMMARY
        priority: medium
      output: TICKET
```

## Implementing Tools

Tools are implemented in your backend:

```typescript
const session = client.agentSessions.attach(sessionId, {
  tools: {
    'get-user-account': async (args) => {
      const userId = args.userId as string;
      const user = await db.users.findById(userId);

      return {
        name: user.name,
        email: user.email,
        plan: user.subscription.plan,
        createdAt: user.createdAt.toISOString(),
      };
    },

    'create-support-ticket': async (args) => {
      const ticket = await ticketService.create({
        summary: args.summary as string,
        priority: args.priority as string,
      });

      return {
        ticketId: ticket.id,
        estimatedResponse: getEstimatedTime(args.priority),
      };
    },
  },
});
```

## Tool Best Practices

### 1. Clear Descriptions

```yaml
tools:
  # Good - clear and specific
  get-user-account:
    description: >
      Retrieves the user's account information including name, email,
      subscription plan, and account creation date. Use this when the
      user asks about their account or you need to verify their identity.

  # Avoid - vague
  get-data:
    description: Gets some data
```

### 2. Document Constrained Values

```yaml
tools:
  create-support-ticket:
    parameters:
      priority:
        type: string
        description: Ticket priority level (low, medium, high, urgent)
```
