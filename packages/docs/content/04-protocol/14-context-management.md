---
title: Context Management
description: Automatic context-window compaction so long sessions keep running past the model's limit.
---

# Context Management

Long-running sessions accumulate history - messages, tool results, screenshots, file reads. Once that history approaches the model's context window, the provider rejects the request and the session would otherwise fail. `contextManagement` (set in the [agent config](/docs/protocol/agent-config)) makes the agent robust to both pressures: it automatically compacts older history as it fills up, and - when you set `maxToolOutputTokens` - it caps how much any single tool result puts into context, so a long task, a long conversation, or one oversized tool output keeps the session running.

Compaction and bounding transform only what the **model sees** on each request. The stored conversation is never changed - the complete history is always preserved.

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
    maxToolOutputTokens: 300000 # safety cap on a single tool result (no default)
```

| Field                 | Required | Description                                                                                                          |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `summarizerWorker`    | No       | Slug of a worker (declared in `workers:`) that produces the running summary. Enables summarization-based compaction. |
| `thresholdPercent`    | No       | Fraction of the model's context window at which compaction starts (default `0.8`).                                   |
| `maxToolOutputTokens` | No       | Max tokens a single tool result may add to the model's view (see below). No default - bounding is off unless set.    |
| `recentWindow`        | No       | Deprecated and ignored. The recent window is now an adaptive token budget sized from the context window.             |

## How it works

- When `maxToolOutputTokens` is set, every tool result is **bounded** before it enters the model's view: anything over the budget is replaced with a head-and-tail preview plus a note saying how much was omitted and how to fetch the rest. The full result is still preserved in the stored conversation, so nothing is lost - the model just sees a bounded copy and can narrow, page, or search for more.
- When the prompt crosses `thresholdPercent` of the context window, the oldest turns are folded into a **running summary** while the original task and the most-recent turns (an adaptive token budget) are kept verbatim - so the agent keeps the goal and full fidelity on what it is doing now.
- Compaction is **incremental**: each cycle only summarizes the newly-expired turns and folds them into the existing summary, so cost stays bounded no matter how long the session runs.
- If the model rejects a request for being too long anyway, the agent recovers automatically (it reduces context and retries) rather than failing the session.

## Bounded tool output

Some tool calls return very large output - a big file read, a full-page extract, a large MCP or skill result. Left unbounded, one such call can blow past the context window in a single step. Set `maxToolOutputTokens` to cap how much of any single result reaches the model, while the full result stays in the stored conversation and the trace.

There is no default: bounding only happens when you set `maxToolOutputTokens`, so the runtime never silently truncates output you did not ask it to. When a result is truncated, the model is always told what was omitted and how to retrieve it, so it can decide to narrow the request, paginate, or read a specific range.

## The summarizer worker

`summarizerWorker` points at a worker you define and ship like any other (see [Workers](/docs/protocol/workers)). It takes two inputs - `PREVIOUS_SUMMARY` (the running summary so far) and `CONVERSATION` (the older turns to fold in) - and returns the updated summary.

Declare it in the top-level `workers:` section so it can be resolved, but keep it **out** of `agent.workers`: that list is what the model can call as a tool, and the summarizer is invoked automatically, never chosen by the model.

Without a `summarizerWorker`, the agent still recovers from a context overflow by reducing older tool results, but it won't produce a summary of earlier turns.

## What users see

Because the summarizer is a worker, it surfaces like any other worker, following its `display` mode (a subtle `description` indicator by default). Compaction is otherwise seamless - the conversation reads as one continuous thread and the complete history is preserved.
