---
title: Context Management
description: Automatic context-window compaction so long sessions keep running past the model's limit.
---

# Context Management

Long-running sessions accumulate history - messages, tool results, screenshots, file reads. Once that history approaches the model's context window, the provider rejects the request and the session would otherwise fail. Two [agent config](/docs/protocol/agent-config) knobs make the agent robust to this: `maxToolOutputTokens` caps how much any single tool result puts into context, and `contextManagement` automatically compacts older history as it fills up. Together they keep a long task, a long conversation, or one oversized tool output from ending the session.

Compaction and bounding shape the agent's **working state** - both what the model sees on each request and what the session persists between turns - so a long session stays bounded and keeps running instead of growing without limit. The complete, untruncated record of every tool result lives in the session's execution logs and trace, not in the working state.

## Configuration

```yaml
workers:
  context-summarizer: # the worker that produces the running summary
    description: Summarizes earlier conversation to free up context
    display: title

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  maxToolOutputTokens: 64000 # cap on a single tool result, in the view and in storage (no default)
  # context-summarizer is intentionally NOT listed in agent.workers,
  # so the model never sees it as a callable tool.
  contextManagement:
    summarizerWorker: context-summarizer
    thresholdPercent: 0.8 # proactive trigger (no default; omit = reactive only)
    recentPercent: 0.3 # recent window kept verbatim (no default; omit = no summarization)
```

`maxToolOutputTokens` is a top-level `agent` field (a sibling of `model` and `system`), because bounding a single tool result is independent of history compaction. Workers set the same cap per thread on their [`start-thread`](/docs/protocol/workers) block. `contextManagement` groups the compaction knobs:

| Field              | Required | Description                                                                                                                                                                                                             |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summarizerWorker` | No       | Slug of a worker (declared in `workers:`) that produces the running summary. Enables summarization-based compaction.                                                                                                    |
| `thresholdPercent` | No       | Fraction of the model's context window at which compaction starts. No default; omit to disable proactive compaction.                                                                                                    |
| `recentPercent`    | No       | Fraction of the context window kept verbatim as the recent window. No default; omit to disable summarization.                                                                                                           |
| `recentWindow`     | No       | Deprecated and ignored. Superseded by `recentPercent` (a context-window fraction).                                                                                                                                      |
| `input`            | No       | Values bound into the summarizer worker's inputs, resolved from the agent's scope - the same rules as [`workers.<slug>.input`](/docs/protocol/workers#input-binding). Typically used to choose what compaction runs on. |

## How it works

- When `maxToolOutputTokens` is set, every tool result is **bounded**: anything over the budget is replaced with a head-and-tail preview plus a note saying how much was omitted and how to fetch the rest. The bounded preview is what the model sees _and_ what the session stores, so one oversized result can never dominate context or the stored state; the full, untruncated result is preserved in the execution logs and trace. The model can narrow, page, or search for more.
- When `thresholdPercent` is set and the prompt crosses that fraction of the context window, the oldest turns are folded into a **running summary** while the original task and the most-recent turns (`recentPercent` of the context window, a token budget) are kept verbatim - so the agent keeps the goal and full fidelity on what it is doing now. The folded summary replaces those older turns in the stored working state too, keeping it bounded. Both knobs are opt-in with no default: omit them and the agent does no proactive compaction, relying on the automatic recovery below.
- Compaction is **incremental**: each cycle only summarizes the newly-expired turns and folds them into the existing summary, so cost stays bounded no matter how long the session runs.
- If the model rejects a request for being too long anyway, the agent recovers automatically (it reduces context and retries) rather than failing the session.
- The same automatic recovery covers **image constraints**. If a provider rejects a request because it carries too many images or an image that is too large - the sort of limit [`maxImageDimension`](/docs/protocol/agent-config#image-delivery-limits) is designed to pre-empt - the agent adapts the outgoing images (downscaling over-limit ones, dropping the oldest when a count limit is hit) and retries, then remembers the limit for the rest of the session so later steps comply up front. As with token overflow, this recovery is only active when `contextManagement` is declared; without it, the rejection surfaces as a clear, well-classified failure. Every image adaptation is recorded as an `image-adapted` entry in the execution logs, and the original full-resolution images are always preserved.

## Bounded tool output

Some tool calls return very large output - a big file read, a full-page extract, a large MCP or skill result. Left unbounded, one such call can blow past the context window in a single step, and it accumulates in the session's stored state. Set `maxToolOutputTokens` on the agent (or, for a worker, on its `start-thread` block) to cap how much of any single result reaches the model _and_ how much is persisted, while the full result stays in the execution logs and trace.

There is no default: bounding only happens when you set `maxToolOutputTokens`, so the runtime never silently truncates output you did not ask it to. When a result is truncated, the model is always told what was omitted and how to retrieve it, so it can decide to narrow the request, paginate, or read a specific range.

Bounding is never hidden: each time a tool result first crosses the budget, a `tool-output-bounded` entry is recorded in the session's execution logs with the tool name, the original size, and the cap. The full, untruncated result stays in the corresponding `tool-result` log entry, so you can always see both what the model saw and the complete output.

## The summarizer worker

`summarizerWorker` points at a worker you define and ship like any other (see [Workers](/docs/protocol/workers)). The runtime always supplies it two inputs - `PREVIOUS_SUMMARY` (the running summary so far) and `CONVERSATION` (the older turns to fold in) - and it returns the updated summary. A summarizer may also declare inputs of its own - most commonly a `MODEL` to summarize on - which you bind from the agent's scope with [`contextManagement.input`](#choosing-what-compaction-runs-on).

Summarization is gated on its sizing knobs: a worker only runs if you also set `recentPercent` (the recent window it folds around), and it only runs **proactively** if you also set `thresholdPercent`. Set a worker without `recentPercent` and it never runs - validation warns you about this.

Declare it in the top-level `workers:` section so it can be resolved, but keep it **out** of `agent.workers`: that list is what the model can call as a tool, and the summarizer is invoked automatically, never chosen by the model.

Without a `summarizerWorker`, the agent still recovers from a context overflow by reducing older tool results, but it won't produce a summary of earlier turns.

## Choosing what compaction runs on

The summarizer is invoked by the runtime, not the model, so the agent supplies any inputs its worker declares beyond `PREVIOUS_SUMMARY` and `CONVERSATION` through `contextManagement.input`, resolved from the agent's own scope - exactly like [`workers.<slug>.input`](/docs/protocol/workers#input-binding). An `UPPER_SNAKE` name that exists in the agent's scope resolves to that value; anything else is a literal.

The common use is deciding which model compaction runs on. Declare `MODEL` (and optionally `BACKUP_MODEL` / `THINKING`) on your summarizer worker, wire them into its `start-thread`, then bind them from the agent:

```yaml
workers:
  context-summarizer:
    description: Summarizes earlier conversation to free up context
    display: title

agent:
  model: MODEL
  contextManagement:
    summarizerWorker: context-summarizer
    thresholdPercent: 0.8
    recentPercent: 0.3
    input:
      MODEL: MODEL # summarize on the agent's own model
      # or a literal model id to pin a specific (e.g. cheaper) model for compaction
```

`PREVIOUS_SUMMARY` and `CONVERSATION` are always supplied by the runtime and cannot be overridden by a binding. With nothing bound, the summarizer runs on whatever its own input defaults declare.

## What users see

Because the summarizer is a worker, it surfaces like any other worker, following its `display` mode (a subtle label-only `title` indicator by default). Compaction is otherwise seamless - the conversation reads as one continuous thread, and the complete record stays available in the session's execution logs and trace.

## Stored state and the full record

These knobs make the working state a **bounded** projection of the session, not an ever-growing transcript: the stored conversation holds the same bounded tool results the model sees, plus the running summary in place of folded turns. This is what keeps a long, tool-heavy session persistable no matter how long it runs. A session that declares no bounds may still grow past the platform's storage limit; when that happens it ends cleanly and recoverably ("start a new session") rather than getting stuck.

Because the stored state is a bounded projection, it is the agent's working memory, not the archival record. `GET /api/agent-sessions/{id}` returns that working state, so once a session has compacted it reflects the bounded, summarized conversation rather than every original turn. For the complete, untruncated history - every tool result at full size - read the session's **execution logs / trace**, which is the durable record. This is driven entirely by the bounds you declare: an agent that sets neither knob keeps its full conversation in the working state (until it risks the storage limit); an agent that sets them opts into the bounded projection.
