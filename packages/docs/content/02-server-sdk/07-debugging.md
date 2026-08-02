---
title: Debugging
description: Execution log telemetry, model request tracing, and debugging tools for Octavus agents.
---

# Debugging

## Always-On Model Telemetry

Every session's execution log includes lightweight model telemetry by default - no configuration needed:

- **Model request markers** - a `model-request` entry for every provider call (LLM and media generation) recording when the request happened, plus the provider and model. Without tracing enabled, the entry carries no request payload, so it stays cheap even for high-volume production sessions.
- **Step stats** - a `step-stats` entry after each LLM step with the token usage breakdown: input tokens, cache reads and writes, output tokens, and reasoning tokens, plus the prompt-cache mode the provider applied. This is the primary signal for understanding where a session's tokens and cost go.

Both appear in the execution log timeline - via [`getLogs()`](/docs/server-sdk/sessions#getting-execution-logs) and in the dashboard's execution log views. To capture the full request payloads as well, enable model request tracing.

## Model Request Tracing

Model request tracing upgrades `model-request` entries to carry the full payload sent to model providers during agent execution. This helps you understand exactly what was sent - system prompts, messages, tool definitions, and provider options - making it easier to debug agent behavior.

### Enabling Tracing

Enable tracing by setting `traceModelRequests: true` in the client config:

```typescript
import { OctavusClient } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL!,
  apiKey: process.env.OCTAVUS_API_KEY!,
  traceModelRequests: true,
});
```

When enabled, the SDK sends an `X-Octavus-Trace: true` header with every request. The platform captures the full model request payload before each provider call and stores it in the execution logs.

You can also drive this from an environment variable for per-environment control:

```typescript
const client = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL!,
  apiKey: process.env.OCTAVUS_API_KEY!,
  traceModelRequests: process.env.TRACE_MODEL_REQUESTS === 'true',
});
```

### What Gets Captured

**LLM requests** include:

- Full system prompt
- All messages in AI SDK format (post-conversion)
- Tool names, descriptions, and JSON schemas
- Provider-specific options (thinking budgets, etc.)
- Temperature, max steps, and thinking configuration

**Media generation requests** (image, video, speech, transcription) include:

- The generation prompt (image and video)
- Request parameters - aspect ratio, resolution, duration, voice, format, or language
- Whether reference images were provided

### Where Traces Appear

Traces appear as **Model Request** entries in the execution log timeline, alongside existing entries like triggers, tool calls, and responses. Each trace is linked to the block that made the model call.

In the Octavus dashboard:

- **Session debug view** - Full execution log with expandable model request entries
- **Agent preview** - Activity panel shows model requests in the execution steps

Each entry shows the raw JSON payload with a copy button for easy inspection.

### Storage

Traces are stored in Redis alongside other execution log entries with a 24-hour TTL. They are not permanently stored. A typical LLM trace with 10 messages and 5 tools is 10-50KB; without tracing, model-request markers are a few hundred bytes. Media traces are small even when traced (just the prompt and request parameters).

### Recommendations

| Environment | Recommendation                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Development | Enable - helps debug agent behavior during development                                                             |
| Staging     | Enable - useful for pre-production testing                                                                         |
| Production  | Disable (default) - the always-on markers and step stats keep timing and token visibility without the storage cost |

### Preview Sessions

Model request tracing is always enabled for preview sessions in the Octavus dashboard. No configuration needed - the platform automatically traces all model requests when using the agent preview.
