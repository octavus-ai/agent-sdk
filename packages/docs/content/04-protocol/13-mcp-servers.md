---
title: MCP Servers
description: Connecting agents to external tools via Model Context Protocol (MCP).
---

# MCP Servers

MCP servers extend your agent with tools from external services. Define them in your protocol, and agents automatically discover and use their tools at runtime.

There are two types of MCP servers:

| Source   | Description                                                        | Example                        |
| -------- | ------------------------------------------------------------------ | ------------------------------ |
| `remote` | HTTP-based MCP servers, managed by the platform                    | Figma, Sentry, GitHub          |
| `device` | Local MCP servers running on the consumer's machine via server-sdk | Browser automation, filesystem |

## Defining MCP Servers

MCP servers are defined in the `mcpServers:` section. The key becomes the **namespace** for all tools from that server.

```yaml
mcpServers:
  figma:
    description: Figma design tool integration
    source: remote
    display: description

  browser:
    description: Chrome DevTools browser automation
    source: device
    display: name
```

### Fields

| Field         | Required | Description                                                                                             |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `description` | Yes      | What the MCP server provides                                                                            |
| `source`      | Yes      | `remote` (platform-managed) or `device` (consumer-provided)                                             |
| `display`     | No       | How tool calls appear in UI: `hidden`, `name`, `description` (default: `description`)                   |
| `connection`  | No       | When to connect: `eager` or `lazy` (default: `lazy`). Remote only.                                      |
| `execution`   | No       | Where the MCP process runs: `sandbox` (default) or `device`. See [Device Execution](#device-execution). |

### Display Modes

Display modes control visibility of all tool calls from the MCP server, using the same modes as [regular tools](/docs/protocol/tools#display-modes):

| Mode          | Behavior                               |
| ------------- | -------------------------------------- |
| `hidden`      | Tool calls run silently                |
| `name`        | Shows tool name while executing        |
| `description` | Shows tool description while executing |

## Making MCP Servers Available

Like tools, MCP servers defined in `mcpServers:` must be referenced in `agent.mcpServers` to be available:

```yaml
mcpServers:
  figma:
    description: Figma design tool integration
    source: remote
    display: description

  sentry:
    description: Error tracking and debugging
    source: remote
    display: name

  browser:
    description: Chrome DevTools browser automation
    source: device
    display: name

  filesystem:
    description: Filesystem access for reading and writing files
    source: device
    display: hidden

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  mcpServers: [figma, sentry, browser, filesystem]
  tools: [set-chat-title]
  agentic: true
  maxSteps: 100
```

## Tool Namespacing

All MCP tools are automatically namespaced using `__` (double underscore) as a separator. The namespace comes from the `mcpServers` key.

For example, a server defined as `browser:` that exposes `navigate_page` and `click` produces:

- `browser__navigate_page`
- `browser__click`

A server defined as `figma:` that exposes `get_design_context` produces:

- `figma__get_design_context`

The namespace is stripped before calling the MCP server - the server receives the original tool name. This convention matches Anthropic's MCP integration in Claude Desktop and ensures tool names stay unique across servers.

### What the LLM Sees

When an agent has both regular tools and MCP servers configured, the LLM sees all tools combined:

```
Protocol tools:
  set-chat-title

Remote MCP tools (auto-discovered):
  figma__get_design_context
  figma__get_screenshot
  sentry__get_issues
  sentry__get_issue_details

Device MCP tools (auto-discovered):
  browser__navigate_page
  browser__click
  browser__take_snapshot
  filesystem__read_file
  filesystem__write_file
  filesystem__list_directory
```

You don't define individual MCP tool schemas in the protocol - they're auto-discovered from each MCP server at runtime.

## Remote MCP Servers

Remote MCP servers (`source: remote`) connect to HTTP-based MCP endpoints. The platform manages the connection, authentication, and tool discovery.

Configuration happens in the Octavus platform UI:

1. Add an MCP server to your project (URL + authentication)
2. The server's slug must match the namespace in your protocol
3. The platform connects, discovers tools, and makes them available to the agent

### Connection Modes

The `connection` field controls when the platform connects to a remote MCP server:

| Mode    | Behavior                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `lazy`  | (default) The agent activates integrations on demand at runtime. The agent starts responding immediately.              |
| `eager` | The platform connects and discovers tools before the first LLM request. Tools are guaranteed available from message 1. |

```yaml
mcpServers:
  sentry:
    source: remote
    connection: eager # Always connected upfront
    display: name

  notion:
    source: remote
    # connection defaults to lazy - agent activates when needed
    display: description
```

With **lazy connection** (the default), the agent receives two built-in tools - one for listing available integrations and one for activating them. The agent decides which integrations it needs based on the conversation and activates them on demand. This avoids paying connection latency for integrations the agent doesn't end up using.

With **eager connection**, the platform connects to the MCP server before the first LLM request, exactly like a declared tool. Use this when the agent needs the MCP's tools from the very first message.

The `connection` field is only valid on `source: remote` - device MCPs (`source: device`) have their own connection mechanism through the server-sdk. The `connection` field is respected for remote MCPs with `execution: device` the same way as sandbox MCPs.

### Authentication

Remote MCP servers support multiple authentication methods:

| Auth Type | Description                     |
| --------- | ------------------------------- |
| MCP OAuth | Standard MCP OAuth flow         |
| API Key   | Static API key sent as a header |
| Bearer    | Bearer token authentication     |
| None      | No authentication required      |

Authentication is configured per-project - different projects can connect to the same MCP server with different credentials.

## Device Execution

The `execution` field controls where a remote MCP server's STDIO process runs. By default (`execution: sandbox`), the process runs in the platform's sandbox. When set to `execution: device`, the STDIO process runs on the agent's computer (VM or desktop) instead.

```yaml
mcpServers:
  code-tools:
    description: Code analysis and refactoring tools
    source: remote
    execution: device # STDIO process runs on the agent's computer
    display: name

  sentry:
    description: Error tracking
    source: remote
    # execution defaults to sandbox - runs in the platform
    display: name
```

### When to Use

Use `execution: device` when the MCP server needs access to the agent's local environment - for example, tools that read from the local filesystem, interact with running processes, or need CLIs installed on the device.

### Rules

- `execution` is only meaningful for `source: remote` MCPs that use STDIO transport. HTTP-transport remote MCPs always connect from the platform regardless of the `execution` setting.
- `execution: device` is **invalid** on `source: device` MCPs (they already run on the device by definition). Using it produces a validation error.
- The `connection` field (`eager` or `lazy`) is respected for device-executed MCPs the same way as sandbox-executed MCPs.

## Device MCP Servers

Device MCP servers (`source: device`) run on the consumer's machine. The consumer provides the MCP tools via the `@octavus/computer` package (or any `ToolProvider` implementation) through the server-sdk.

When an agent has device MCP servers:

1. The consumer creates a `Computer` with matching namespaces
2. `@octavus/computer` discovers tools from each MCP server
3. Tool schemas are sent to the platform via the server-sdk
4. Tool calls flow back to the consumer for execution

See [`@octavus/computer`](/docs/server-sdk/computer) for the full integration guide.

### Namespace Matching

The `mcpServers` keys in the protocol must match the keys in the consumer's `Computer` configuration:

```yaml
# protocol.yaml
mcpServers:
  browser: # ← must match
    source: device
  filesystem: # ← must match
    source: device
```

```typescript
const computer = new Computer({
  mcpServers: {
    browser: Computer.stdio('chrome-devtools-mcp', ['--browser-url=...']),
    filesystem: Computer.stdio('@modelcontextprotocol/server-filesystem', [dir]),
  },
});
```

If the consumer provides a namespace not declared in the protocol, the platform rejects it.

## Thread-Level Scoping

Threads can scope which MCP servers are available, the same way they scope [tools](/docs/protocol/handlers#start-thread):

```yaml
handlers:
  user-message:
    Start research:
      block: start-thread
      thread: research
      mcpServers: [figma, browser]
      tools: [set-chat-title]
      system: research-prompt
```

This thread can use Figma and browser tools, but not sentry or filesystem - even if those are available on the main agent.

## On-Demand MCP Servers

By default, an agent can only call MCP tools whose namespace is listed in `mcpServers`. With `onDemandMcpServers`, a scope can opt into **every connected MCP of a given source** at runtime, without enumerating each one in the protocol.

Remote MCPs are connected at the project level from the Octavus dashboard. Normally, each connected MCP that the agent should be able to use has to be declared in the protocol - connecting a new MCP means editing the protocol and redeploying. `onDemandMcpServers` removes that round-trip: once a source is opted in, any MCP connected to the project under that source becomes available to the agent immediately.

Currently supported for `source: remote`.

### Protocol-level declaration

Add an `onDemandMcpServers:` section alongside `mcpServers:`, keyed by source. Each entry configures how the matched MCPs appear in tool lists:

```yaml
mcpServers:
  figma:
    description: Figma design tool integration
    source: remote
    display: description

onDemandMcpServers:
  remote:
    description: Additional connected integrations
    display: name
    execution: device # on-demand MCPs run on the agent's computer
    contextRetention:
      toolResults: { retainLast: 5 }
```

On-demand MCP definitions also support the `execution` field. When set, all MCPs matched by that on-demand source inherit the execution mode.

### Scope-level opt-in

The agent and individual `start-thread` blocks each choose whether to pick up on-demand MCPs, by listing the sources they want:

```yaml
agent:
  mcpServers: [figma]
  onDemandMcpServers: [remote]

handlers:
  user-message:
    focused:
      block: start-thread
      mcpServers: [figma]
      # no onDemandMcpServers - this thread does NOT see on-demand MCPs
    broad:
      block: start-thread
      mcpServers: [figma]
      onDemandMcpServers: [remote]
```

### Rules

- A scope's tool list includes every **connected** MCP of any referenced source, whether or not any protocol declares that slug.
- Undeclared namespaces inherit `description`, `display`, and `contextRetention` from the per-source entry in `onDemandMcpServers`.
- Scopes decide independently - threads do not inherit `onDemandMcpServers` from their parent, the same rule as `mcpServers:`.
- Tool namespaces are always the connector's slug (for example `notion__search`, `linear__create_issue`). Source keys are never namespaces.

Workers opt into on-demand MCPs the same way: through `start-thread` blocks inside `steps`. A worker without a `start-thread` that lists a source won't see on-demand MCPs of that source.

## Workers

Workers can declare and use MCP servers using the same `mcpServers:` syntax. Workers resolve their own MCP connections independently - they don't inherit from a parent interactive agent.

```yaml
# Worker protocol
mcpServers:
  sentry:
    description: Error tracking and debugging
    source: remote
    display: name
  browser:
    description: Chrome DevTools browser automation
    source: device
    display: name

steps:
  Start research:
    block: start-thread
    thread: research
    model: anthropic/claude-sonnet-4-5
    system: system
    mcpServers: [sentry, browser]
    maxSteps: 10
```

Since workers don't have a global `agent:` section, MCP servers are scoped per-thread via `start-thread` - the same way tools and skills work in workers. Remote MCP connections are project-scoped, so workers in the same project share the same OAuth connections.

See [Workers](/docs/protocol/workers) for the full worker protocol reference.

## Full Example

```yaml
mcpServers:
  figma:
    description: Figma design tool integration
    source: remote
    connection: eager
    display: description
  sentry:
    description: Error tracking and debugging
    source: remote
    display: name
  browser:
    description: Chrome DevTools browser automation
    source: device
    display: name
  filesystem:
    description: Filesystem access for reading and writing files
    source: device
    display: hidden
  shell:
    description: Shell command execution
    source: device
    display: name

tools:
  set-chat-title:
    description: Set the title of the current chat.
    parameters:
      title: { type: string, description: The title to set }

agent:
  model: anthropic/claude-opus-4-6
  system: system
  mcpServers: [figma, sentry, browser, filesystem, shell]
  tools: [set-chat-title]
  thinking: medium
  maxSteps: 300
  agentic: true

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

### Cloud-Only Agent

Agents that only use remote MCP servers don't need `@octavus/computer`:

```yaml
mcpServers:
  figma:
    description: Figma design tool integration
    source: remote
    connection: eager # Need design tools from message 1
    display: description
  sentry:
    description: Error tracking and debugging
    source: remote
    # Lazy (default) - agent activates when debugging is needed
    display: name

tools:
  submit-code:
    description: Submit code to the user.
    parameters:
      code: { type: string }

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  mcpServers: [figma, sentry]
  tools: [submit-code]
  agentic: true
```
