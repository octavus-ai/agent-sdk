---
title: Tools
description: Defining external tools implemented in your backend.
---

# Tools

Tools extend what agents can do. Octavus supports multiple types:

1. **External Tools** - Defined in the protocol, implemented in your backend (this page)
2. **MCP Tools** - Auto-discovered from MCP servers (see [MCP Servers](/docs/protocol/mcp-servers))
3. **Built-in Tools** - Provider-agnostic tools managed by Octavus (web search, image generation)
4. **Provider Tools** - Provider-specific tools executed by the provider (e.g., Anthropic's code execution)
5. **Skills** - Code execution and knowledge packages (see [Skills](/docs/protocol/skills))

This page covers external tools. For MCP-based tools from services like Figma, Sentry, or device capabilities like browser and filesystem, see [MCP Servers](/docs/protocol/mcp-servers). Built-in tools are enabled via agent config - see [Web Search](/docs/protocol/agent-config#web-search) and [Image Generation](/docs/protocol/agent-config#image-generation). For provider-specific tools, see [Provider Options](/docs/protocol/provider-options). For code execution, see [Skills](/docs/protocol/skills).

## External Tools

External tools are defined in the `tools:` section and implemented in your backend.

## Defining Tools

```yaml
tools:
  get-user-account:
    description: Looking up your account information
    display: title
    title: Looking up your account
    parameters:
      userId:
        type: string
        description: The user ID to look up
```

### Tool Fields

| Field         | Required | Description                                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `description` | Yes      | What the tool does (shown to LLM and optionally user)                                             |
| `display`     | No       | How to show in UI: `title` (default), `stream`, or `hidden` (`name`/`description` are deprecated) |
| `title`       | No       | User-facing UI label (used in `title` and `stream` modes; falls back to the tool name)            |
| `parameters`  | No       | Input parameters the tool accepts                                                                 |

### Display Modes

Controls what the client sees about tool execution. There are three modes; the default is `title`.

| Mode     | Behavior                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`  | **Default.** A label-only indicator: the tool's `title` (falling back to the tool name) plus the tool name that drives the icon. Arguments and result are hidden in the UI; the `description` is still sent to the LLM. Use for tools that should appear as a clean, labeled step without exposing inputs/outputs. |
| `stream` | Full visibility. Arguments stream progressively as the LLM generates them, and the result is shown after execution (and preserved after refresh). Its label follows the same `title ?? name` rule. Use when the user benefits from seeing arguments/results.                                                       |
| `hidden` | No UI events emitted. The tool executes silently and the user has no awareness it was called. Use for internal plumbing tools (title setting, context management).                                                                                                                                                 |

The visible label is always `title ?? name` - your UI decides how to render the tool name (`UIToolCallPart.toolName`, which also drives the icon), and the `description` is **never** shown as the UI label (it is prompt text written for the model).

> **Deprecated modes.** `name` (shows the tool name only) and `description` (shows the `description` as the label) still work for backward compatibility, but protocol validation now emits a deprecation warning. Prefer `title` (a clean label plus the name) or `stream` (full visibility).

**When to use `stream`:**

- Client tools where the user benefits from seeing arguments or results
- Interactive client tools (user provides input via the tool card)
- Tools whose result is rendered via `renderToolCallResult`
- Any tool where transparency into what was sent/received matters

**When to use `hidden`:**

- Internal lifecycle tools (e.g., session title setting)
- Context-setting tools that would clutter the UI
- Tools that are implementation details of the agent's protocol

**When to use `title`:**

- Server-side tools that should appear in the UI as a clean, labeled step (e.g. "Looking up your account") without exposing their arguments or result
- Tools whose `description` is written for the LLM and shouldn't be shown verbatim to the user
- This is the recommended mode for server-executed tools that should be visible: give them a human-readable `title` for the UI and keep `description` focused on instructing the model

`title` is the preferred choice for server-side tools that should surface in the UI. `name` and `description` remain supported for backward compatibility, but for new server-side tools prefer `title` (a clean UI label) - or `stream` for client tools where the user benefits from seeing the arguments and result.

**Refresh and restore behavior:**

`stream` is the only mode that preserves the tool result after a page refresh. For all other modes, the result is available during the live session but stripped on refresh. On session restore (when the session expires and is rebuilt from stored `UIMessage[]`), `stream` tools retain their original result while other modes receive a placeholder.

## Parameters

Tool calls are always objects where each parameter name maps to a value. The LLM generates: `{ param1: value1, param2: value2, ... }`

### Parameter Fields

| Field         | Required | Description                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `type`        | Yes      | Data type: `string`, `number`, `integer`, `boolean`, `unknown`, or a custom type |
| `description` | No       | Describes what this parameter is for                                             |
| `optional`    | No       | If true, parameter is not required (default: false)                              |

> **Tip**: You can use [custom types](/docs/protocol/types) for complex parameters like `type: ProductFilter`, a [top-level array type](/docs/protocol/types#top-level-array-types) for lists, or a [top-level scalar type](/docs/protocol/types#top-level-scalar-types) with `enum` to constrain a parameter to a fixed set of values.

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

### Enum Parameters

To constrain a parameter to a fixed set of values, define a [top-level scalar type](/docs/protocol/types#top-level-scalar-types) with `enum` and use it. This keeps the allowed set in the schema - steering the model and rejecting invalid values - while the call stays flat:

```yaml
types:
  ThermostatMode:
    type: string
    enum: [heat, cool, auto, off]

tools:
  set-thermostat-mode:
    description: Set the thermostat operating mode
    parameters:
      mode:
        type: ThermostatMode
        description: The operating mode to switch to
```

The tool receives: `{ mode: "cool" }`.

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

### 2. Constrain Values in the Schema

Prefer a named [enum type](/docs/protocol/types#top-level-scalar-types) over describing the allowed values in prose - the schema then steers the model and rejects invalid values, instead of relying on the description alone:

```yaml
types:
  TicketPriority:
    type: string
    enum: [low, medium, high, urgent]
    description: Ticket priority level

tools:
  create-support-ticket:
    parameters:
      priority:
        type: TicketPriority
```
