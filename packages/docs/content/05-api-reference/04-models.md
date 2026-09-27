---
title: Models
description: Public catalog of usable models with pricing.
---

# Models API

List the models you can use in an agent, each with a copy-ready model id and per-1M-token pricing. This is the same catalog shown at [octavus.ai/pricing/models](https://octavus.ai/pricing/models) and behind the MCP [`list_models`](/docs/mcp/tools#models) tool, shaped for programmatic use - for example, building a model picker or comparing costs.

Chat and image models must come from this catalog, whether called on a direct provider (Anthropic, Google, OpenAI, SpaceXAI, Octavus) or through OpenRouter: a protocol that names any other model fails validation, and a session that resolves to one fails with `MODEL_NOT_SUPPORTED`. The one exception is your own OpenRouter key, which can run any OpenRouter model. See [Unsupported Models](/docs/protocol/agent-config#unsupported-models), which also covers video, speech, and transcription models.

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
      "openRouterId": "openrouter/anthropic/claude-sonnet-4.5",
      "contextLength": 200000,
      "pricingBasis": "fixed",
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
      "id": "openrouter/deepseek/deepseek-v4.1-flash",
      "name": "DeepSeek: DeepSeek V4.1 Flash",
      "provider": "deepseek",
      "routing": "openrouter",
      "openRouterId": "openrouter/deepseek/deepseek-v4.1-flash",
      "contextLength": 1048576,
      "pricingBasis": "fixed",
      "pricing": {
        "inputPer1M": "0.30",
        "outputPer1M": "1.20",
        "cacheReadPer1M": "0.007",
        "reasoningPer1M": null,
        "bandwidthPer1M": "0.104",
        "tiers": []
      }
    },
    {
      "id": "openrouter/typesafe/jev-router",
      "name": "TypeSafe: Jev Router",
      "provider": "typesafe",
      "routing": "openrouter",
      "openRouterId": "openrouter/typesafe/jev-router",
      "contextLength": 1000000,
      "pricingBasis": "served-model",
      "pricing": {
        "inputPer1M": null,
        "outputPer1M": null,
        "cacheReadPer1M": null,
        "reasoningPer1M": null,
        "bandwidthPer1M": null,
        "tiers": []
      }
    }
  ]
}
```

| Field                    | Type           | Description                                                                                                                                                                                                                             |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | string         | Copy-ready model id for an agent's [`model`](/docs/protocol/agent-config) field.                                                                                                                                                        |
| `name`                   | string         | Human-readable display name.                                                                                                                                                                                                            |
| `provider`               | string         | Underlying provider slug (e.g. `anthropic`, `deepseek`).                                                                                                                                                                                |
| `routing`                | string         | `direct` for the direct providers (OpenAI, Anthropic, Google, SpaceXAI), or `openrouter` otherwise.                                                                                                                                     |
| `openRouterId`           | string \| null | The id that runs the model through OpenRouter (for your own OpenRouter key): the same as `id` for an OpenRouter route, an `openrouter/`-prefixed id for a direct-provider model, or `null` when the model can't run through OpenRouter. |
| `contextLength`          | number \| null | Maximum context window in tokens, when known. A router's is the largest window among the models it picks from.                                                                                                                          |
| `pricingBasis`           | string         | `fixed` when the model is billed at `pricing`, or `served-model` for a [router](/docs/protocol/agent-config#routers), billed each step at the cost OpenRouter reports for the model it picks - every `pricing` rate is then `null`.     |
| `pricing.inputPer1M`     | string \| null | Input token price per 1M tokens, in USD.                                                                                                                                                                                                |
| `pricing.outputPer1M`    | string \| null | Output token price per 1M tokens, in USD.                                                                                                                                                                                               |
| `pricing.cacheReadPer1M` | string \| null | Cached input read price per 1M tokens, when the model supports prompt caching.                                                                                                                                                          |
| `pricing.reasoningPer1M` | string \| null | Reasoning output price per 1M tokens, when priced separately.                                                                                                                                                                           |
| `pricing.bandwidthPer1M` | string \| null | Platform bandwidth fee per 1M tokens.                                                                                                                                                                                                   |
| `pricing.tiers`          | array          | Context-length pricing tiers (empty for flat pricing). Each entry has a `minInputTokens` threshold and its own `inputPer1M` / `outputPer1M`.                                                                                            |

Prices are strings to preserve decimal precision. Models outside the direct providers are routed through OpenRouter and carry the `openrouter/` prefix - copy the `id` exactly as shown. To run a direct-provider model through OpenRouter instead (for example on your own OpenRouter key), use its `openRouterId` exactly as shown too: OpenRouter's spelling can differ from the direct id, as in `openrouter/anthropic/claude-sonnet-4.5` next to `anthropic/claude-sonnet-4-5`.

A request through OpenRouter is billed the exact cost OpenRouter reports for it. For a model that runs on its provider's own endpoint (see [OpenRouter routing](/docs/protocol/agent-config#openrouter-routing)), the rate listed is the most a request costs: an off-peak or cached request costs less. A model on OpenRouter's default routing is billed what the host that served it charged, which can differ from the rate listed. A router is billed the reported cost of the model it picked for each step.

### Example

```bash
# All models
curl https://octavus.ai/api/models

# Filter to one provider
curl "https://octavus.ai/api/models?provider=anthropic"
```
