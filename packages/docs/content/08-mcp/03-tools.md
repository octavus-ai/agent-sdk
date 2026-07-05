---
title: Tools
description: The tools the Octavus MCP server exposes to your AI coding tool.
---

# Tools

The server exposes a focused set of tools. Read tools are available on any connection; **write** tools appear only on a read-and-write connection. Lists are paginated (pass the `nextCursor` from a previous response to get the next page).

## Platform agents

| Tool             | Access | Description                                                                                                    |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `list_projects`  | read   | List the projects you can access.                                                                              |
| `list_agents`    | read   | List the platform agents in a project.                                                                         |
| `get_agent`      | read   | Get an agent as CLI-format files: `settings`, `protocol.yaml`, `prompts`, `references`.                        |
| `validate_agent` | read   | Validate an agent definition without saving (dry run), like `octavus validate`.                                |
| `deploy_agent`   | write  | Create or update an agent from CLI-format files, like `octavus sync`. Supports partial (changed-only) updates. |

### Editing an agent

A typical write loop mirrors the CLI:

1. `get_agent` to fetch the current files.
2. Edit locally.
3. `validate_agent` to check the change.
4. `deploy_agent` to apply it. By default only the files you send change and the rest are preserved; set `replace: true` to replace the full prompt/reference set.

## Sessions

| Tool                | Access | Description                                                          |
| ------------------- | ------ | -------------------------------------------------------------------- |
| `list_sessions`     | read   | List recent sessions in a project, optionally filtered to one agent. |
| `get_session_trace` | read   | Get a session's execution trace as readable markdown for debugging.  |

Traces are available while the session log is warm (about 24 hours after the run). Noisy model-request telemetry is excluded by default; pass `includeModelRequests: true` to include it.

## Octavus Agents

| Tool                      | Access | Description                                                                                 |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `list_workforce_agents`   | read   | List the Octavus Agents you can access.                                                     |
| `list_workforce_threads`  | read   | List an agent's chat threads.                                                               |
| `read_workforce_thread`   | read   | Read a thread's messages and status. Pass `wait: true` to long-poll until the run finishes. |
| `send_to_workforce_agent` | write  | Send a message to an agent by id or name, starting or continuing a thread.                  |

### Sending a task and reading the result

Because agent runs are asynchronous, driving one is a two-step pattern:

1. `send_to_workforce_agent` with the agent name (e.g. `"Anna BDR"`) and your message. It returns a `threadId`.
2. `read_workforce_thread` with that `threadId` and `wait: true`. It waits up to ~25 seconds for the run to finish and returns the messages; if the run is still going, it returns `isRunning: true` and you call `read_workforce_thread` again.
