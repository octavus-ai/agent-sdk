---
title: Overview
description: What the Octavus MCP server is and what it lets your AI coding tool do.
---

# Octavus MCP Server

The Octavus MCP server lets you connect your Octavus account to an AI coding tool - **Cursor**, **Claude Code**, or any [MCP](https://modelcontextprotocol.io)-compliant client - and work with your Octavus resources without leaving your editor.

Once connected, your tool can:

- **Inspect and debug platform agents** - list your projects and agents, read an agent's full definition, and read a session's execution trace to see exactly what happened during a run.
- **Deploy changes to platform agents** - edit an agent's files locally and push them back, the same way the `octavus` CLI syncs.
- **Read and drive your Octavus Agents** - list your agents and their chat threads, read a thread, and send a new message ("Ask Anna BDR to draft the follow-up email"), then read the response.

## How it works

The MCP server is a **remote HTTP server** - there is no package to install and no local process to run. You point your client at one URL and sign in with your Octavus account through OAuth:

1. Your client discovers how to authenticate from the server URL.
2. You sign in to Octavus (Google or email/password) and approve the connection.
3. You pick an **access level** - read-only or read and write.
4. Your client is connected and stays connected; you never copy or paste a token.

## Acting as you

Every action the MCP server takes runs **as you**, with exactly the permissions you have in the Octavus dashboard - the same projects, agents, and Octavus Agents you can see and manage. It can never do more than you can, and a **read-only** connection can never make changes. The connection is scoped to a single organization.

You can review and disconnect connected apps at any time from **Account -> Connected apps**.

## Environments

| Environment | MCP URL                   |
| ----------- | ------------------------- |
| Production  | `https://octavus.ai/mcp`  |
| Staging     | `https://octavus.dev/mcp` |

Continue to [Connecting](/docs/mcp/connecting) to add the server to your client.
