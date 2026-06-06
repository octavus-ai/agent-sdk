---
title: Fast Mode
description: Run supported Anthropic Opus models at higher output speed for latency-sensitive agents.
---

# Fast Mode

Fast mode runs a supported Anthropic Opus model with a faster inference configuration - higher output tokens per second, same weights and behavior - at premium pricing. Enable it with the `speed` field in the [agent config](/docs/protocol/agent-config):

```yaml
agent:
  model: anthropic/claude-opus-4-8
  speed: fast # fast | standard (default)
```

| Mode       | Behavior                                                     | When to use                                                                         |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `standard` | Default speed and pricing. Used whenever `speed` is omitted. | Most agents.                                                                        |
| `fast`     | Higher output speed at a premium per-token rate.             | Latency-sensitive, interactive agents where faster responses are worth the premium. |

Fast mode is orthogonal to thinking - it's a speed/price knob, not an intelligence one, and keeps full reasoning.

## Supported models

Fast mode only applies to **Anthropic Opus 4.8, 4.7, and 4.6**. On any other model or provider it is a **no-op**: the request runs at standard speed and price, and never errors. This makes it safe to leave `speed: fast` set when using a dynamic model (resolved from input) that might turn out not to support it.

When you set `speed: fast` on a literal model that does not support it, the protocol validator surfaces a non-fatal warning in the dashboard.

## Premium pricing

Fast mode applies a per-model multiplier over the model's standard rates, to both input and output across the full context window:

| Model          | Fast-mode cost |
| -------------- | -------------- |
| Opus 4.8       | ~2x standard   |
| Opus 4.7 / 4.6 | ~6x standard   |

Prompt-caching costs continue to apply on top of the fast-mode base rates. Billing always reflects the speed a request **actually** ran at: a request that falls back to standard speed (see below) is billed at standard rates, so requesting fast never by itself triggers premium billing.

## Rate limits and fallback

Fast mode has a dedicated rate limit, separate from standard Opus limits. When it is exhausted the agent degrades gracefully instead of failing: the request automatically retries at standard speed on the same model, then falls back to your configured [backup model](/docs/protocol/agent-config) if needed, before surfacing an error.

Falling back to standard speed is a prompt-cache miss, since fast and standard requests do not share cached prefixes. The fallback is recorded in the session trace, so it is clear when a request that asked for fast ran at standard (or on the backup model) and why.

## Routing

A supported Opus model can be reached through more than one provider, and fast mode is expressed differently on each - the `speed` field handles the translation:

| Route             | Example model                               | How fast mode is enabled                                          |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Direct Anthropic  | `anthropic/claude-opus-4-8`                 | `speed: fast`                                                     |
| Vercel AI Gateway | `vercel/anthropic/claude-opus-4.7`          | `speed: fast`                                                     |
| OpenRouter        | `openrouter/anthropic/claude-opus-4.8-fast` | Select the dedicated `-fast` model slug (`speed` is ignored here) |

## Passing speed as input

Like `thinking`, `speed` accepts a variable reference so consumers choose it per session:

```yaml
input:
  SPEED:
    type: string
    description: Inference speed (fast/standard)
    optional: true

agent:
  model: anthropic/claude-opus-4-8
  speed: SPEED # Resolved from session input; unset -> standard
  system: system
```

An unset optional variable resolves to `standard`, so existing agents are never silently upgraded to premium pricing.

## Scope

`speed` follows the same scoping as `thinking`: set it at agent scope (the main thread default) or per named thread in a `start-thread` block (see [Thread-Specific Config](/docs/protocol/agent-config)). Because worker agents configure everything through their thread, that is also how a worker enables fast mode. Thread settings take precedence over the agent default.
