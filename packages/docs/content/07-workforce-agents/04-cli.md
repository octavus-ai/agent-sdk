---
title: Agent CLI
description: Run a Workforce Agent on a Linux machine you control, using that machine as the agent's computer.
---

# Agent CLI

The `@octavus/agent` package (the `octoagent` command) runs one of your Workforce Agents on a Linux machine you control, using that machine as the agent's computer. The agent's brain (model, tools, sub-agents, skills, connections) runs on Octavus exactly as it does everywhere else. The CLI just drives the browser, computer-use, filesystem, and shell on the machine you run it on, and every run shows up as a normal thread on the agent in the dashboard, live while it runs and afterward.

> The Agent CLI is the bring-your-own-computer way to run an agent. It is different from `@octavus/cli` (the `octavus` command), which manages agent definitions you build with the SDK. See [CLI](/docs/server-sdk/cli) for that tool.

## When to use it

Reach for it when you want an agent to act on a specific machine: servers, CI, and benchmark harnesses (anything shaped like "install a CLI, give it a key, run a prompt"). A run is locally triggered and ephemeral - the CLI is both the trigger and the computer for that one run, then exits. To drive an agent's own managed computer over the network instead, use the [Workforce Agents API](/docs/workforce-agents/overview).

## Set up the agent

In the dashboard, open the agent's **Computer** settings, choose **"Your own machine (CLI)"** (under "More options"), and confirm. That agent then has no managed computer, so its manual chat, schedule, and notifications are turned off - it is driven only from the CLI. Its threads stay visible.

Then mint an agent API key from the agent's **Settings -> API** tab. The key drives only that one agent, is a secret (use it from a server, script, or CI, never in a browser), and is shown only once.

## Install

```bash
curl -fsSL https://octavus.ai/install/agent-cli.sh | sh
```

The installer sets up the prerequisites a full computer needs on a standard Linux box (Node 20+, a headless X display via Xvfb, the AT-SPI accessibility bus, Chrome for Testing) so "install and run" just works. A shell + filesystem only agent needs none of the display stack.

If you already have those prerequisites, install the package directly:

```bash
npm install -g @octavus/agent
```

## Quick start

```bash
# Configure once with the agent's API key (the only credential you handle).
octoagent auth --api-key oct_agt_xxx

# Run a prompt in the current directory (the agent's filesystem/shell root).
cd ~/projects/my-task
octoagent run "Summarize the README and open the repo's homepage in the browser."
```

The working directory you launch in is the agent's workspace (override with `--workdir`). Durable per-agent data - the browser profile (so logins persist across runs) and cached skills - lives under `~/.octavus/<env>/<agentId>/`, never in your working directory.

## Commands

### `octoagent run "<prompt>"`

Run one prompt to completion and exit.

| Flag                                       | Description                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `--workdir <dir>`                          | The agent's filesystem/shell root (default: current directory).                                         |
| `--api-key <oct_agt_...>`                  | Override the stored key for this run.                                                                   |
| `--platform-url <url>`                     | Override the platform base URL.                                                                         |
| `--env <name>`                             | Environment to use (default: `production`; see below).                                                  |
| `--chrome-path <path>`                     | Path to Chrome for Testing (else resolved from `PATH`).                                                 |
| `--model <provider/model-id>`              | Model for this run only (else the agent's default).                                                     |
| `--backup-model <provider/model-id>`       | Backup model for this run only.                                                                         |
| `--thinking <off\|low\|medium\|high\|max>` | Thinking/reasoning effort for this run only. `max` is each provider's maximum; `off` disables thinking. |
| `--capability <slug>=<on\|off>`            | Toggle one capability for this run (repeatable).                                                        |
| `--config <file>`                          | JSON run config for scripted sweeps (see below).                                                        |
| `--json`                                   | Print one machine-readable JSON result to stdout.                                                       |
| `--force`                                  | Allow running with the workspace at `$HOME` or `/`.                                                     |
| `--verbose`                                | Print diagnostics to stderr.                                                                            |

### Other commands

- `octoagent auth --api-key <oct_agt_...> [--platform-url <url>] [--env <name>]` - store credentials.
- `octoagent config [--env <name>]` - show the current configuration.
- `octoagent version [--env <name>]` - show the CLI and platform-supported versions.

## Run configuration

Configure how the agent runs for a single invocation without changing its dashboard settings. Any field you omit inherits the agent's configured default; the agent's stored configuration is never modified by a run.

```bash
# Choose the model + backup model for this run only.
octoagent run --model openrouter/moonshotai/kimi-k2 --backup-model anthropic/claude-sonnet-5 "..."

# Set the thinking/reasoning effort for this run only (max = the provider's maximum).
octoagent run --model anthropic/claude-opus-4-8 --thinking max "..."

# Toggle capabilities for this run (repeatable). Unlisted capabilities inherit the agent default.
octoagent run --capability memory=off --capability handbook=on "..."

# Or carry it all in a JSON file for scripted, repeatable sweeps.
octoagent run --config run.json "..."
```

`run.json`:

```json
{
  "model": "openrouter/moonshotai/kimi-k2",
  "backupModel": "anthropic/claude-sonnet-5",
  "thinking": "high",
  "capabilities": { "memory": false }
}
```

Precedence: explicit flags > `--config` file > the agent's dashboard defaults. Any model from the [model catalog](https://octavus.ai/pricing/models) is allowed, as is any OpenRouter or Vercel AI Gateway route, as long as a key resolves for its provider (your project/org key or the platform default); any other model (see [Unsupported Models](/docs/protocol/agent-config#unsupported-models)), or an unrunnable or malformed one, is rejected up front, before the run starts. Capability toggles are bounded to the capabilities the agent's protocol declares.

## Machine-readable output

`--json` prints exactly one JSON object to stdout - `{ "threadId", "sessionId", "status", "threadUrl" }` - with all human and progress output routed to stderr, so a harness can capture and correlate a run without scraping text. Read the full transcript and a per-run cost/usage summary from the thread with the same agent key, either with the [SDK](/docs/workforce-agents/sdk) (`client.workforce.getThread(agentId, threadId)`) or the [REST API](/docs/workforce-agents/api-reference).

## Stopping a run

A CLI run has no live chat, but you can still stop it from the dashboard: open its thread and click **Stop**. The run is force-stopped on the machine and the CLI process exits with code `4` (its `--json` output reports `"status": "cancelled"`). This is handy when you fan out several runs from a server and want to halt some of them.

## Environments

`--env <name>` (or `OCTAVUS_ENV`, default `production`) selects an environment. Each keeps its own credentials and browser profile under `~/.octavus/<env>/`, so you can configure and run more than one side by side without them clobbering each other:

```bash
octoagent auth --api-key oct_agt_prod            # production (default)
octoagent run "..."
```

`production` targets `https://octavus.ai` with no extra config; any other environment needs its `--platform-url` set once (stored per environment).

## Exit codes

| Code | Meaning                    |
| ---- | -------------------------- |
| `0`  | Completed                  |
| `1`  | Failed                     |
| `2`  | Bad usage                  |
| `3`  | Update required            |
| `4`  | Stopped from the dashboard |

## Notes

- **One run per machine.** Runs on one machine share that machine's computer (browser profile, display), so running the same agent twice on one machine can collide. Running the same agent from many machines at once is fine and independent.
- **No resume.** If the CLI stops, crashes, or loses its network mid-run, the run fails - start a new one. For long runs, run detached (e.g. `nohup`) so a closed terminal doesn't kill it.
- **Network identity is the machine's own.** Nothing is manufactured; a residential machine can pass strict logins, a datacenter box may be challenged.
- **Billing is unchanged** - the same hourly agent-time plus platform and provider cost as any run. Bringing your own computer doesn't change the bill.
