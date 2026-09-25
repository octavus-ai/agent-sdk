---
title: Models
description: Public catalog of usable models with pricing.
---

# Models API

List the models you can use in an agent, each with a copy-ready model id and per-1M-token pricing. This is the same catalog shown at [octavus.ai/pricing/models](https://octavus.ai/pricing/models) and behind the MCP [`list_models`](/docs/mcp/tools#models) tool, shaped for programmatic use - for example, building a model picker or comparing costs.

Chat and image models must come from this catalog, whether called on a direct provider (Anthropic, Google, OpenAI, xAI, Octavus) or through OpenRouter: a protocol that names any other model fails validation, and a session that resolves to one fails with `MODEL_NOT_SUPPORTED`. See [Unsupported Models](/docs/protocol/agent-config#unsupported-models), which also covers video, speech, and transcription models.

## Public access

Unlike the rest of the API, this endpoint is **public - no authentication required**. It is rate-limited per client IP (exceeding the limit returns `429`) and cached, so treat it as reference data rather than a high-frequency call.

## List Models

```
GET /api/models
```

### Query Parameters

| Parameter  | Type   | Required | Description                                                  |
| ---------- | ------ | -------- | ------------------------------------------------------------ |
| `provider` | string | No       | Filter to one provider slug, e.g. `anthropic` or `deepseek`. |

### Response

```json
{
  "models": [
    {
      "id": "anthropic/claude-sonnet-4-5",
      "name": "Anthropic: Claude Sonnet 4.5",
      "provider": "anthropic",
      "routing": "direct",
      "contextLength": 200000,
      "pricing": {
        "inputPer1M": "3.00",
        "outputPer1M": "15.00",
        "cacheReadPer1M": "0.30",
        "reasoningPer1M": null,
        "bandwidthPer1M": "0.50",
        "tiers": []
      }
    },
    {
      "id": "openrouter/deepseek/deepseek-chat",
      "name": "DeepSeek: DeepSeek V3",
      "provider": "deepseek",
      "routing": "openrouter",
      "contextLength": 163840,
      "pricing": {
        "inputPer1M": "0.32",
        "outputPer1M": "0.89",
        "cacheReadPer1M": null,
        "reasoningPer1M": null,
        "bandwidthPer1M": "0.10",
        "tiers": []
      }
    }
  ]
}
```

| Field                    | Type           | Description                                                                                                                                  |
| ------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | string         | Copy-ready model id for an agent's [`model`](/docs/protocol/agent-config) field.                                                             |
| `name`                   | string         | Human-readable display name.                                                                                                                 |
| `provider`               | string         | Underlying provider slug (e.g. `anthropic`, `deepseek`).                                                                                     |
| `routing`                | string         | `direct` for the direct providers (OpenAI, Anthropic, Google, xAI), or `openrouter` otherwise.                                               |
| `contextLength`          | number \| null | Maximum context window in tokens, when known.                                                                                                |
| `pricing.inputPer1M`     | string         | Input token price per 1M tokens, in USD.                                                                                                     |
| `pricing.outputPer1M`    | string         | Output token price per 1M tokens, in USD.                                                                                                    |
| `pricing.cacheReadPer1M` | string \| null | Cached input read price per 1M tokens, when the model supports prompt caching.                                                               |
| `pricing.reasoningPer1M` | string \| null | Reasoning output price per 1M tokens, when priced separately.                                                                                |
| `pricing.bandwidthPer1M` | string         | Platform bandwidth fee per 1M tokens.                                                                                                        |
| `pricing.tiers`          | array          | Context-length pricing tiers (empty for flat pricing). Each entry has a `minInputTokens` threshold and its own `inputPer1M` / `outputPer1M`. |

Prices are strings to preserve decimal precision. Models outside the direct providers are routed through OpenRouter and carry the `openrouter/` prefix - copy the `id` exactly as shown.

### Example

```bash
# All models
curl https://octavus.ai/api/models

# Filter to one provider
curl "https://octavus.ai/api/models?provider=anthropic"
```
