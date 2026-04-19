---
title: Computer
description: Adding browser, filesystem, and shell capabilities to agents with @octavus/computer.
---

# Computer

The `@octavus/computer` package gives agents access to a physical or virtual machine's browser, filesystem, and shell. It connects to [MCP](https://modelcontextprotocol.io) servers, discovers their tools, and provides them to the server-sdk.

**Current version:** `{{VERSION:@octavus/computer}}`

## Installation

```bash
npm install @octavus/computer
```

## Quick Start

```typescript
import { Computer } from '@octavus/computer';
import { OctavusClient } from '@octavus/server-sdk';

const computer = new Computer({
  mcpServers: {
    browser: Computer.stdio('chrome-devtools-mcp', ['--browser-url=http://127.0.0.1:9222']),
    filesystem: Computer.stdio('@modelcontextprotocol/server-filesystem', ['/path/to/workspace']),
    shell: Computer.shell({ cwd: '/path/to/workspace', mode: 'unrestricted' }),
  },
});

await computer.start();

const client = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: 'your-api-key',
});

const session = client.agentSessions.attach(sessionId, {
  tools: {
    'set-chat-title': async (args) => ({ title: args.title }),
  },
});

session.setDynamicTools(computer);
```

Dynamic tools are registered after attaching via `session.setDynamicTools()`. Pass the `computer` directly - the session extracts schemas and handlers from the `ToolProvider`. Tool schemas are sent to the platform on the next `execute()` call, and tool calls flow back through the existing execution loop.

## How It Works

1. You configure MCP servers with namespaces (e.g., `browser`, `filesystem`, `shell`)
2. `computer.start()` connects to all servers in parallel and discovers their tools
3. Each tool is namespaced with `__` (e.g., `browser__navigate_page`, `filesystem__read_file`)
4. The server-sdk sends tool schemas to the platform and handles tool call execution

The agent's protocol must declare matching `mcpServers` with `source: device` - see [MCP Servers](/docs/protocol/mcp-servers).

## Entry Types

The `Computer` class supports three types of MCP entries:

### Stdio (MCP Subprocess)

Spawns an MCP server as a child process, communicating via stdin/stdout:

```typescript
Computer.stdio(command: string, args?: string[], options?: {
  env?: Record<string, string>;
  cwd?: string;
})
```

Use this for local MCP servers installed as npm packages or standalone executables:

```typescript
const computer = new Computer({
  mcpServers: {
    browser: Computer.stdio('chrome-devtools-mcp', [
      '--browser-url=http://127.0.0.1:9222',
      '--no-usage-statistics',
    ]),
    filesystem: Computer.stdio('@modelcontextprotocol/server-filesystem', [
      '/Users/me/projects/my-app',
    ]),
  },
});
```

### HTTP (Remote MCP Endpoint)

Connects to an MCP server over Streamable HTTP:

```typescript
Computer.http(url: string, options?: {
  headers?: Record<string, string>;
})
```

Use this for MCP servers running as HTTP services:

```typescript
const computer = new Computer({
  mcpServers: {
    docs: Computer.http('http://localhost:3001/mcp', {
      headers: { Authorization: 'Bearer token' },
    }),
  },
});
```

### Shell (Built-in)

Provides shell command execution without spawning an MCP subprocess:

```typescript
Computer.shell(options: {
  cwd?: string;
  mode: ShellMode;
  timeout?: number;  // Default: 300,000ms (5 minutes)
})
```

This exposes a `run_command` tool (namespaced as `shell__run_command` when the key is `shell`). Commands execute in a login shell with the user's full environment.

```typescript
const computer = new Computer({
  mcpServers: {
    shell: Computer.shell({
      cwd: '/Users/me/projects/my-app',
      mode: 'unrestricted',
      timeout: 300_000,
    }),
  },
});
```

#### Shell Safety Modes

| Mode                                   | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| `'unrestricted'`                       | All commands allowed (for dedicated machines) |
| `{ allowedPatterns, blockedPatterns }` | Pattern-based command filtering               |

Pattern-based filtering:

```typescript
Computer.shell({
  cwd: workspaceDir,
  mode: {
    blockedPatterns: [/rm\s+-rf/, /sudo/],
    allowedPatterns: [/^git\s/, /^npm\s/, /^ls\s/],
  },
});
```

When `allowedPatterns` is set, only matching commands are permitted. When `blockedPatterns` is set, matching commands are rejected. Blocked patterns are checked first.

## Lifecycle

### Starting

`computer.start()` connects to all configured MCP servers in parallel. If some servers fail to connect, the computer still starts with the remaining servers - only if _all_ connections fail does it throw an error.

```typescript
const { errors } = await computer.start();

if (errors.length > 0) {
  console.warn('Some MCP servers failed to connect:', errors);
}
```

### Stopping

`computer.stop()` closes all MCP connections and kills managed processes:

```typescript
await computer.stop();
```

Always call `stop()` when the session ends to clean up MCP subprocesses. For managed processes (like Chrome), pass them in the config for automatic cleanup.

## Chrome Launch Helper

For desktop applications that need to control a browser, `Computer.launchChrome()` launches Chrome with remote debugging enabled:

```typescript
const browser = await Computer.launchChrome({
  profileDir: '/Users/me/.my-app/chrome-profiles/agent-1',
  debuggingPort: 9222, // Optional, auto-allocated if omitted
  flags: ['--window-size=1280,800'],
});

console.log(`Chrome running on port ${browser.port}, PID ${browser.pid}`);
```

Pass the browser to `managedProcesses` for automatic cleanup when the computer stops:

```typescript
const computer = new Computer({
  mcpServers: {
    browser: Computer.stdio('chrome-devtools-mcp', [
      `--browser-url=http://127.0.0.1:${browser.port}`,
    ]),
    filesystem: Computer.stdio('@modelcontextprotocol/server-filesystem', [workspaceDir]),
    shell: Computer.shell({ cwd: workspaceDir, mode: 'unrestricted' }),
  },
  managedProcesses: [{ process: browser.process }],
});
```

### ChromeLaunchOptions

| Field           | Required | Description                                           |
| --------------- | -------- | ----------------------------------------------------- |
| `profileDir`    | Yes      | Directory for Chrome's user data (profile isolation)  |
| `debuggingPort` | No       | Port for remote debugging (auto-allocated if omitted) |
| `flags`         | No       | Additional Chrome launch flags                        |

## ToolProvider Interface

`Computer` implements the `ToolProvider` interface from `@octavus/core`:

```typescript
interface ToolProvider {
  toolHandlers(): Record<string, ToolHandler>;
  toolSchemas(): ToolSchema[];
}
```

`setDynamicTools()` accepts any `ToolProvider` directly - the session extracts schemas and handlers automatically:

```typescript
session.setDynamicTools(computer);
```

You can also pass a custom `ToolProvider`:

```typescript
const customProvider: ToolProvider = {
  toolHandlers() {
    return {
      custom__my_tool: async (args) => {
        return { result: 'done' };
      },
    };
  },
  toolSchemas() {
    return [
      {
        name: 'custom__my_tool',
        description: 'A custom tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Tool input' },
          },
          required: ['input'],
        },
      },
    ];
  },
};

const session = client.agentSessions.attach(sessionId, {
  tools: { 'set-chat-title': titleHandler },
});

session.setDynamicTools(customProvider);
```

For cases where you need explicit control, `setDynamicTools()` also accepts a `DynamicTool[]` array:

```typescript
interface DynamicTool {
  schema: ToolSchema;
  handler: ToolHandler;
}
```

## Complete Example

A desktop application with browser, filesystem, and shell capabilities:

```typescript
import { Computer } from '@octavus/computer';
import { OctavusClient } from '@octavus/server-sdk';

const WORKSPACE_DIR = '/Users/me/projects/my-app';
const PROFILE_DIR = '/Users/me/.my-app/chrome-profiles/agent';

async function startSession(sessionId: string) {
  // 1. Launch Chrome with remote debugging
  const browser = await Computer.launchChrome({
    profileDir: PROFILE_DIR,
  });

  // 2. Create computer with all capabilities
  const computer = new Computer({
    mcpServers: {
      browser: Computer.stdio('chrome-devtools-mcp', [
        `--browser-url=http://127.0.0.1:${browser.port}`,
        '--no-usage-statistics',
      ]),
      filesystem: Computer.stdio('@modelcontextprotocol/server-filesystem', [WORKSPACE_DIR]),
      shell: Computer.shell({
        cwd: WORKSPACE_DIR,
        mode: 'unrestricted',
      }),
    },
    managedProcesses: [{ process: browser.process }],
  });

  // 3. Connect to all MCP servers
  const { errors } = await computer.start();
  if (errors.length > 0) {
    console.warn('Failed to connect:', errors);
  }

  // 4. Attach to session and register dynamic tools
  const client = new OctavusClient({
    baseUrl: process.env.OCTAVUS_API_URL!,
    apiKey: process.env.OCTAVUS_API_KEY!,
  });

  const session = client.agentSessions.attach(sessionId, {
    tools: {
      'set-chat-title': async (args) => {
        console.log('Chat title:', args.title);
        return { success: true };
      },
    },
  });

  session.setDynamicTools(computer);

  // 5. Execute and stream
  const events = session.execute({
    type: 'trigger',
    triggerName: 'user-message',
    input: { USER_MESSAGE: 'Navigate to github.com and take a screenshot' },
  });

  for await (const event of events) {
    // Handle stream events
  }

  // 6. Clean up
  await computer.stop();
}
```

## API Reference

### Computer

```typescript
class Computer implements ToolProvider {
  constructor(config: ComputerConfig);

  // Static factories for MCP entries
  static stdio(
    command: string,
    args?: string[],
    options?: {
      env?: Record<string, string>;
      cwd?: string;
    },
  ): StdioConfig;

  static http(
    url: string,
    options?: {
      headers?: Record<string, string>;
    },
  ): HttpConfig;

  static shell(options: { cwd?: string; mode: ShellMode; timeout?: number }): ShellConfig;

  // Chrome launch helper
  static launchChrome(options: ChromeLaunchOptions): Promise<ChromeInstance>;

  // Lifecycle
  start(): Promise<{ errors: string[] }>;
  stop(): Promise<void>;

  // ToolProvider implementation
  toolHandlers(): Record<string, ToolHandler>;
  toolSchemas(): ToolSchema[];
}
```

### ComputerConfig

```typescript
interface ComputerConfig {
  mcpServers: Record<string, McpEntry>;
  managedProcesses?: { process: ChildProcess }[];
}

type McpEntry = StdioConfig | HttpConfig | ShellConfig;
type ShellMode =
  | 'unrestricted'
  | {
      allowedPatterns?: RegExp[];
      blockedPatterns?: RegExp[];
    };
```

### ChromeInstance

```typescript
interface ChromeInstance {
  port: number;
  process: ChildProcess;
  pid: number;
}
```
