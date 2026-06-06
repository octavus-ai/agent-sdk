---
title: Context Management
description: Automatic context-window compaction so long sessions keep running past the model's limit.
---

# Context Management

Long-running sessions accumulate history - messages, tool results, screenshots, file reads. Once that history approaches the model's context window, the provider rejects the request and the session would otherwise fail. `contextManagement` (set in the [agent config](/docs/protocol/agent-config)) makes the agent automatically compact older history as it fills up, so a long task or a long conversation keeps running.

Compaction transforms only what the **model sees** on each request. The stored conversation is never changed - the complete history is always preserved.

## Configuration

```yaml
workers:
  context-summarizer: # the worker that produces the running summary
    description: Summarizes earlier conversation to free up context
    display: description

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  # context-summarizer is intentionally NOT listed in agent.workers,
  # so the model never sees it as a callable tool.
  contextManagement:
    summarizerWorker: context-summarizer
    thresholdPercent: 0.8
    recentWindow: 30
```

| Field              | Required | Description                                                                                                          |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `summarizerWorker` | No       | Slug of a worker (declared in `workers:`) that produces the running summary. Enables summarization-based compaction. |
| `thresholdPercent` | No       | Fraction of the model's context window at which compaction starts (default `0.8`).                                   |
| `recentWindow`     | No       | Number of most-recent messages always kept verbatim in the model's view (default `30`).                              |

## How it works

- When the prompt crosses `thresholdPercent` of the context window, the oldest turns are folded into a **running summary** while the original task and the most recent turns (the `recentWindow`) are kept verbatim - so the agent keeps the goal and full fidelity on what it is doing now.
- Compaction is **incremental**: each cycle only summarizes the newly-expired turns and folds them into the existing summary, so cost stays bounded no matter how long the session runs.
- If the model rejects a request for being too long anyway, the agent recovers automatically (it reduces context and retries) rather than failing the session.

## The summarizer worker

`summarizerWorker` points at a worker you define and ship like any other (see [Workers](/docs/protocol/workers)). It takes two inputs - `PREVIOUS_SUMMARY` (the running summary so far) and `CONVERSATION` (the older turns to fold in) - and returns the updated summary.

Declare it in the top-level `workers:` section so it can be resolved, but keep it **out** of `agent.workers`: that list is what the model can call as a tool, and the summarizer is invoked automatically, never chosen by the model.

Without a `summarizerWorker`, the agent still recovers from a context overflow by reducing older tool results, but it won't produce a summary of earlier turns.

## What users see

Because the summarizer is a worker, it surfaces like any other worker, following its `display` mode (a subtle `description` indicator by default). Compaction is otherwise seamless - the conversation reads as one continuous thread and the complete history is preserved.
