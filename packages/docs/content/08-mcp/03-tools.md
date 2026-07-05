---
title: Tools
description: The tools the Octavus MCP server exposes to your AI coding tool.
---

# Tools

The server exposes a focused set of tools. Read tools are available on any connection; **write** tools appear only on a read-and-write connection. Lists are paginated (pass the `nextCursor` from a previous response to get the next page).

Tools are namespaced by product surface: `*_platform_*` tools work with the agents you build yourself, and `*_workforce_*` tools work with your Octavus Agents. They are different things and never overlap.

## Platform agents

The agents you build with the SDK/CLI, inside a project - distinct from your [Octavus Agents](#octavus-agents) below. `get_platform_agent` and `archive_platform_agent` take the agent's `agentId` from `list_platform_agents`; `deploy_platform_agent` addresses the agent by the `slug` in its settings (like `octavus sync`).

| Tool                      | Access | Description                                                                                                    |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `list_projects`           | read   | List the projects you can access.                                                                              |
| `list_platform_agents`    | read   | List the platform agents in a project.                                                                         |
| `get_platform_agent`      | read   | Get an agent as CLI-format files: `settings`, `protocol.yaml`, `prompts`, `references`.                        |
| `validate_platform_agent` | read   | Validate an agent definition without saving (dry run), like `octavus validate`.                                |
| `deploy_platform_agent`   | write  | Create or update an agent from CLI-format files, like `octavus sync`. Supports partial (changed-only) updates. |
| `archive_platform_agent`  | write  | Archive an agent (soft delete): it stops appearing in the project and its slug is freed; history is preserved. |

### Editing an agent

A typical write loop mirrors the CLI:

1. `get_platform_agent` to fetch the current files.
2. Edit locally.
3. `validate_platform_agent` to check the change.
4. `deploy_platform_agent` to apply it. By default only the files you send change and the rest are preserved; set `replace: true` to replace the full prompt/reference set.

## Sessions

Sessions belong to platform agents.

| Tool                | Access | Description                                                                   |
| ------------------- | ------ | ----------------------------------------------------------------------------- |
| `list_sessions`     | read   | List recent sessions in a project, optionally filtered to one platform agent. |
| `get_session_trace` | read   | Get a session's execution trace as readable markdown for debugging.           |

Traces are available while the session log is warm (about 24 hours after the run). Noisy model-request telemetry is excluded by default; pass `includeModelRequests: true` to include it.

## Octavus Agents

Your Octavus Agents (the "workforce") - distinct from the platform agents above. Identify one by its `agentId` from `list_workforce_agents`.

| Tool                      | Access | Description                                                                                                                                  |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_workforce_agents`   | read   | List the Octavus Agents you can access.                                                                                                      |
| `list_workforce_threads`  | read   | List an agent's chat threads (needs its `agentId`).                                                                                          |
| `read_workforce_thread`   | read   | Read a thread's messages and status (needs `agentId` + `threadId`). Pass `wait: true` to long-poll (bounded ~25s; may return still-running). |
| `send_to_workforce_agent` | write  | Send a message to an agent by `agentId`, starting or continuing a thread.                                                                    |

### Sending a task and reading the result

Because agent runs are asynchronous, driving one is a two-step pattern:

1. `send_to_workforce_agent` with the `agentId` (from `list_workforce_agents`) and your message. It returns a `threadId`.
2. `read_workforce_thread` with that agent's `agentId`, the `threadId`, and `wait: true`. The wait is bounded (~25 seconds): it returns the messages as soon as the run finishes, but if the run is still going it returns `isRunning: true` and you must call `read_workforce_thread` again - repeat until `isRunning` is false.
