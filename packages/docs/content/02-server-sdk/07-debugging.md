---
title: Debugging
description: Model request tracing and debugging tools for Octavus agents.
---

# Debugging

## Model Request Tracing

Model request tracing captures the full payload sent to model providers (LLM and image) during agent execution. This helps you understand exactly what was sent - system prompts, messages, tool definitions, and provider options - making it easier to debug agent behavior.

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

**Image generation requests** include:

- Image generation prompt
- Requested size
- Whether reference images were provided

### Where Traces Appear

Traces appear as **Model Request** entries in the execution log timeline, alongside existing entries like triggers, tool calls, and responses. Each trace is linked to the block that made the model call.

In the Octavus dashboard:

- **Session debug view** - Full execution log with expandable model request entries
- **Agent preview** - Activity panel shows model requests in the execution steps

Each entry shows the raw JSON payload with a copy button for easy inspection.

### Storage

Traces are stored in Redis alongside other execution log entries with a 24-hour TTL. They are not permanently stored. A typical LLM trace with 10 messages and 5 tools is 10–50KB. Image traces are smaller (just prompt and metadata).

### Recommendations

| Environment | Recommendation                                             |
| ----------- | ---------------------------------------------------------- |
| Development | Enable - helps debug agent behavior during development     |
| Staging     | Enable - useful for pre-production testing                 |
| Production  | Disable (default) - saves storage for high-volume sessions |

### Preview Sessions

Model request tracing is always enabled for preview sessions in the Octavus dashboard. No configuration needed - the platform automatically traces all model requests when using the agent preview.
