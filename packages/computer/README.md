# @octavus/computer

Computer capability layer for Octavus agents: browser, filesystem, and shell access through MCP servers running on a machine you control.

## Installation

```bash
npm install @octavus/computer @octavus/server-sdk
```

## Overview

A `Computer` connects to a set of [MCP](https://modelcontextprotocol.io) servers, discovers their tools, and hands them to the Server SDK as a `ToolProvider`, so an agent can drive a browser, read and write files, and run shell commands on the machine the `Computer` runs on. Each server gets a namespace, and its tools are exposed as `namespace__tool` (for example `browser__navigate_page`, `filesystem__read_file`, `shell__run_command`).

Three kinds of entries are supported:

- **Stdio** - an MCP server spawned as a child process (`Computer.stdio(command, args)`)
- **HTTP** - a remote MCP server over Streamable HTTP (`Computer.http(url)`)
- **Shell** - a built-in shell tool with safety modes (`Computer.shell({ cwd, mode })`)

The agent's protocol declares matching `mcpServers` with `source: device`.

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

const client = new OctavusClient({ apiKey: process.env.OCTAVUS_API_KEY! });
const session = client.sessions.attach(sessionId);
session.setDynamicTools(computer);

for await (const event of session.execute({
  type: 'trigger',
  triggerName: 'user-message',
  input: { USER_MESSAGE: 'Open the project README and summarize it.' },
})) {
  // stream events
}

await computer.stop();
```

## Documentation

The full guide - entry types, shell safety modes, health checks, and device MCP servers in the protocol - is at [octavus.ai/docs/server-sdk/computer](https://octavus.ai/docs/server-sdk/computer).

## Related Packages

- [`@octavus/server-sdk`](https://www.npmjs.com/package/@octavus/server-sdk) - Server-side SDK the `Computer` plugs into
- [`@octavus/core`](https://www.npmjs.com/package/@octavus/core) - Shared types and utilities

## License

MIT
