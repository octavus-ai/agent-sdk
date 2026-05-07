---
title: Inline MCP Servers
description: Group an integration's tools into a Zod-typed bundle that runs in your server process.
---

# Inline MCP Servers

Inline MCP servers let you group an integration's tools (e.g., GitHub, Salesforce, an internal microservice) into a namespaced bundle with Zod-typed handler arguments. The tools execute in your server process via the same tool-request/continue path as ordinary [server tools](/docs/server-sdk/tools), so authentication and credentials stay in your process.

## When to Use

Use an inline MCP server when:

- You're integrating a third-party API and want a logical grouping (`github__list-prs`, `github__get-issue`).
- You want type-safe handler arguments instead of casting `args` from `unknown`.
- You want to evolve the toolset without protocol-yaml round trips - tool names and schemas are sent at runtime.
- Tool calls need credentials your platform should never see (OAuth tokens, customer API keys).

For comparison with the other tool registration paths, see the [tools overview](/docs/server-sdk/tools#server-tools-vs-client-tools).

## Protocol Declaration

Declare the namespace in `protocol.yaml` with `source: consumer`. The platform learns the namespace and routes tool calls to your process; tool names and JSON schemas are provided by the SDK at runtime.

```yaml
mcpServers:
  github:
    description: Repository management - issues, pull requests, code
    source: consumer
    display: name

agent:
  mcpServers:
    - github
```

See [MCP Servers in the protocol reference](/docs/protocol/mcp-servers) for the full set of MCP source types and field semantics.

## Defining the Server

```typescript
import { z } from 'zod';
import { createInlineMcpServer, defineInlineMcpTool } from '@octavus/server-sdk';

const github = createInlineMcpServer('github', {
  tools: {
    'get-pr-overview': defineInlineMcpTool({
      description: 'Get pull request metadata and file changes',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number(),
      }),
      handler: async (args) => {
        // args is { owner: string; repo: string; pullNumber: number }
        return await githubService.getPrOverview(args.owner, args.repo, args.pullNumber);
      },
    }),

    'list-issues': defineInlineMcpTool({
      description: 'List open issues for a repository',
      parameters: z.object({
        owner: z.string(),
        repo: z.string(),
        state: z.enum(['open', 'closed', 'all']).default('open'),
      }),
      handler: async (args) => {
        return await githubService.listIssues(args.owner, args.repo, args.state);
      },
    }),
  },
});
```

The factory:

1. Validates the namespace and each tool name (see [naming rules](#naming-rules)).
2. Converts each Zod schema to JSON Schema once at creation time.
3. Returns an `InlineMcpServer` exposing `toolSchemas()` and `toolHandlers()`.

The resulting tool names are namespaced: `github__get-pr-overview`, `github__list-issues`.

## Why `defineInlineMcpTool`

`defineInlineMcpTool()` is a no-op at runtime, but it preserves Zod type inference. Without the wrapper, TypeScript collapses the per-tool generic when the tools are placed in a record literal, leaving `args` typed as `unknown`:

```typescript
// Without defineInlineMcpTool - args ends up as `unknown`
tools: {
  'get-pr-overview': {
    description: '...',
    parameters: z.object({ owner: z.string() }),
    handler: async (args) => args.owner, // ❌ TS error: args is 'unknown'
  },
}

// With defineInlineMcpTool - args inferred from the schema
tools: {
  'get-pr-overview': defineInlineMcpTool({
    description: '...',
    parameters: z.object({ owner: z.string() }),
    handler: async (args) => args.owner, // ✓ args is { owner: string }
  }),
}
```

The handler also receives Zod-validated arguments. Invalid inputs throw before reaching your code, with the failed paths and messages joined into the error.

## Attaching to a Session

Pass inline MCP servers via `mcpServers` on `attach()`. They merge with `tools` and survive across `setDynamicTools()` calls:

```typescript
const session = client.agentSessions.attach(sessionId, {
  tools: {
    'get-user-account': async (args) => db.users.findById(args.userId as string),
  },
  mcpServers: [github, salesforce],
});
```

Workers accept the same option:

```typescript
const { output } = await client.workers.generate(agentId, input, {
  mcpServers: [github],
});
```

## Authentication and Credentials

Handlers close over your server's auth context, so credentials never leave your process. The platform receives the namespaced schema list and the tool call name; it never sees the keys you use to fulfill the call.

A common pattern is to build the MCP server per-request when auth depends on the user:

```typescript
function buildGithubMcp(token: string) {
  const client = new GithubClient({ token });
  return createInlineMcpServer('github', {
    tools: {
      'get-pr-overview': defineInlineMcpTool({
        description: 'Get pull request metadata and file changes',
        parameters: z.object({
          owner: z.string(),
          repo: z.string(),
          pullNumber: z.number(),
        }),
        handler: async (args) => client.pulls.get(args),
      }),
    },
  });
}

export async function POST(request: Request) {
  const user = await authenticate(request);
  const session = client.agentSessions.attach(sessionId, {
    mcpServers: [buildGithubMcp(user.githubToken)],
  });

  const events = session.execute(payload, { signal: request.signal });
  return new Response(toSSEStream(events));
}
```

For static credentials (one tenant per deployment), build the server once at module scope.

## How Tool Calls Flow

1. The agent emits a `tool-request` event for `github__get-pr-overview` (or another inline-MCP-namespaced tool).
2. The Server SDK looks up the handler registered by `createInlineMcpServer()` and runs it. Zod validates `args` against the tool's schema; a validation failure becomes a tool error sent back to the LLM.
3. The handler returns; the SDK posts the result back to the platform via the same continuation request used for ordinary server tools.
4. The platform feeds the result to the LLM and streams the next response chunk.

There is no separate transport - inline MCP tools ride on the same `dynamicToolSchemas` channel that device MCPs use, so no additional infrastructure is required.

## Naming Rules

`createInlineMcpServer()` validates the namespace and each tool name at construction time. Invalid values throw immediately:

- **Namespace:** lowercase letters, digits, and hyphens; must start with a letter (`/^[a-z][a-z0-9-]*$/`).
- **Tool name:** lowercase letters, digits, underscores, and hyphens; must start with a letter (`/^[a-z][a-z0-9_-]*$/`).

The resulting `${namespace}__${toolName}` is what the LLM sees and what flows through the platform's MCP routing.

## Collision Rules

The resolver throws on the following conflicts so problems surface at attach time, not mid-stream:

- Each inline MCP server's `namespace` must be unique across the array passed to `attach()` or the workers API.
- A namespaced tool name (`namespace__tool`) cannot collide with a static tool handler key passed via `tools`.
- A namespaced tool name cannot collide with a `dynamicToolSchemas` entry passed to the workers API.

If a tool registered via `setDynamicTools()` later collides with an inline MCP tool name, the dynamic handler wins for the duration of that dynamic-tool set; the inline MCP handler is restored on the next `setDynamicTools()` call that doesn't re-register the same name.

## Inline vs Computer

Both inline MCP and the `Computer` integration register tools that flow through `dynamicToolSchemas`. Pick based on where the tool process runs:

| Tool surface | Process location                 | Best for                                                                                                      |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Inline MCP   | Your server (in-process closure) | Third-party APIs, internal microservices, anything where credentials live in your backend.                    |
| Computer     | The agent's machine (STDIO MCP)  | Browser automation, filesystem, shell - device-local capabilities. See [Computer](/docs/server-sdk/computer). |

The two can coexist on the same session.
