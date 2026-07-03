---
title: Connecting
description: Add the Octavus MCP server to Cursor, Claude Code, or any MCP client.
---

# Connecting

The Octavus MCP server uses standard MCP OAuth, so any compliant client can connect from just the URL:

```
https://octavus.ai/mcp
```

When you connect, your browser opens Octavus, you sign in (if you aren't already), and you choose an access level. After you approve, the client is connected.

## Cursor

Add the server to your Cursor MCP configuration (`~/.cursor/mcp.json` or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "octavus": {
      "url": "https://octavus.ai/mcp"
    }
  }
}
```

Cursor will prompt you to sign in the first time you use it.

## Claude Code

Add the server with the CLI:

```bash
claude mcp add --transport http octavus https://octavus.ai/mcp
```

Run the connection and complete the sign-in when prompted.

## Any MCP client

Point your client at `https://octavus.ai/mcp` as a **Streamable HTTP** server with OAuth. The server implements OAuth 2.1 discovery and dynamic client registration, so no manual client setup is required.

## Access levels

At sign-in you choose one of two levels, which is bound to the connection:

- **Read-only** - inspection and analysis only. Write tools are not even offered to the model.
- **Read and write** - everything read-only allows, plus deploying agent changes and sending messages to your Octavus Agents.

To change the level, disconnect and reconnect.

## Managing connections

Every connected client appears under **Account -> Connected apps** in the dashboard, showing its access level and when it was last used. Disconnect any client there: it can no longer refresh, and its current access expires within an hour, after which it must reconnect to regain access. Changing your password disconnects all clients the same way.
