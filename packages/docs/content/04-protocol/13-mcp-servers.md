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

| Field         | Required | Description                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------------- |
| `description` | Yes      | What the MCP server provides                                                          |
| `source`      | Yes      | `remote` (platform-managed) or `device` (consumer-provided)                           |
| `display`     | No       | How tool calls appear in UI: `hidden`, `name`, `description` (default: `description`) |

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

The namespace is stripped before calling the MCP server — the server receives the original tool name. This convention matches Anthropic's MCP integration in Claude Desktop and ensures tool names stay unique across servers.

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

You don't define individual MCP tool schemas in the protocol — they're auto-discovered from each MCP server at runtime.

## Remote MCP Servers

Remote MCP servers (`source: remote`) connect to HTTP-based MCP endpoints. The platform manages the connection, authentication, and tool discovery.

Configuration happens in the Octavus platform UI:

1. Add an MCP server to your project (URL + authentication)
2. The server's slug must match the namespace in your protocol
3. The platform connects, discovers tools, and makes them available to the agent

### Authentication

Remote MCP servers support multiple authentication methods:

| Auth Type | Description                     |
| --------- | ------------------------------- |
| MCP OAuth | Standard MCP OAuth flow         |
| API Key   | Static API key sent as a header |
| Bearer    | Bearer token authentication     |
| None      | No authentication required      |

Authentication is configured per-project — different projects can connect to the same MCP server with different credentials.

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

This thread can use Figma and browser tools, but not sentry or filesystem — even if those are available on the main agent.

## Full Example

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
    display: description
  sentry:
    description: Error tracking and debugging
    source: remote
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
