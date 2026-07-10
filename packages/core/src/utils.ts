/**
 * Generate a unique ID for messages, tool calls, etc.
 * Format: timestamp-random (e.g., "1702345678901-abc123def")
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Normalizes a tool JSON Schema so every LLM provider accepts it, acting as a
 * safety net for schemas coming from MCP servers or hand-crafted definitions.
 * Two independent concerns, both of which can otherwise 400 a whole request:
 *
 * 1. Top-level `oneOf`/`anyOf`/`allOf` - rejected by Anthropic. Flattened into
 *    a plain object schema (see {@link flattenTopLevelCombinators}) so a single
 *    MCP tool can never take down the agent loop.
 * 2. A `type: "object"` node missing `properties` - rejected by OpenAI
 *    (Anthropic and Google are lenient). A `properties: {}` is filled in on the
 *    root and on every nested object reachable through `properties`.
 *
 * Applies equally to tool `inputSchema` and `outputSchema` - the body is
 * schema-shape agnostic; the name reflects the original use site only.
 *
 * Scope for the `properties` pass: walks `type: "object"` nodes through the
 * `properties` map only. It does not descend into `items`,
 * `additionalProperties`, or `$defs`, and it deliberately leaves *nested*
 * combinators untouched (the provider supports them). Expand here if a
 * real-world schema surfaces a gap.
 */
export function normalizeToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return normalizeObjectProperties(flattenTopLevelCombinators(schema));
}

/**
 * Anthropic rejects a tool `input_schema` whose ROOT declares `oneOf`,
 * `anyOf`, or `allOf` - the Messages API 400s with "input_schema does not
 * support oneOf, allOf, or anyOf at the top level" (nested uses are fine).
 * MCP servers routinely emit a root combinator to express "provide exactly
 * one of these identifiers"-style constraints. Because every tool schema is
 * sent to the provider in a single array, one offending tool rejects the
 * ENTIRE request - taking down the whole agent loop, not just that tool.
 *
 * This collapses a root combinator into a plain object schema the provider
 * accepts: each branch's `properties` are unioned up to the root (so the
 * model still sees every parameter) and the combinator itself is removed.
 * `allOf` branches are all mandatory, so their `required` is preserved;
 * `anyOf`/`oneOf` branches are alternatives, so their branch-level `required`
 * (the mutual-exclusivity rule) is intentionally dropped - the MCP server
 * still enforces the real constraint when the tool is actually called, so
 * nothing is lost at execution time.
 *
 * Only the root is touched. Combinators nested inside `properties` are left
 * intact because the provider supports them and they carry real meaning
 * (e.g. a discriminated-union parameter).
 */
function flattenTopLevelCombinators(schema: Record<string, unknown>): Record<string, unknown> {
  // Destructure the combinator keys out (rather than deleting them off a copy)
  // so `result` never carries a root `allOf`/`anyOf`/`oneOf`.
  const { allOf, anyOf, oneOf, ...rest } = schema;
  const combinators: { jointlyRequired: boolean; branches: unknown }[] = [
    { jointlyRequired: true, branches: allOf },
    { jointlyRequired: false, branches: anyOf },
    { jointlyRequired: false, branches: oneOf },
  ];

  if (!combinators.some(({ branches }) => Array.isArray(branches))) return schema;

  const result: Record<string, unknown> = { ...rest };

  const mergedProperties: Record<string, unknown> =
    typeof result.properties === 'object' && result.properties !== null
      ? { ...(result.properties as Record<string, unknown>) }
      : {};

  const mergedRequired = new Set<string>(
    Array.isArray(result.required)
      ? (result.required as unknown[]).filter((name): name is string => typeof name === 'string')
      : [],
  );

  for (const { jointlyRequired, branches } of combinators) {
    if (!Array.isArray(branches)) continue;

    for (const branch of branches) {
      if (typeof branch !== 'object' || branch === null) continue;
      const branchSchema = branch as Record<string, unknown>;

      const branchProps = branchSchema.properties;
      if (typeof branchProps === 'object' && branchProps !== null) {
        for (const [propName, propSchema] of Object.entries(
          branchProps as Record<string, unknown>,
        )) {
          // Root properties win over branch copies of the same key.
          if (!(propName in mergedProperties)) {
            mergedProperties[propName] = propSchema;
          }
        }
      }

      // Only `allOf` branches are jointly required; anyOf/oneOf are alternatives.
      if (jointlyRequired && Array.isArray(branchSchema.required)) {
        for (const name of branchSchema.required as unknown[]) {
          if (typeof name === 'string') mergedRequired.add(name);
        }
      }
    }
  }

  result.type = 'object';
  result.properties = mergedProperties;

  const finalRequired = [...mergedRequired].filter((name) => name in mergedProperties);
  if (finalRequired.length > 0) {
    result.required = finalRequired;
  } else {
    delete result.required;
  }

  return result;
}

function normalizeObjectProperties(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type !== 'object') return schema;

  const normalized = { ...schema };

  if (!('properties' in normalized)) {
    normalized.properties = {};
  }

  if (typeof normalized.properties === 'object' && normalized.properties !== null) {
    const props = normalized.properties as Record<string, unknown>;
    const normalizedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      normalizedProps[key] =
        typeof value === 'object' && value !== null
          ? normalizeObjectProperties(value as Record<string, unknown>)
          : value;
    }
    normalized.properties = normalizedProps;
  }

  return normalized;
}

/**
 * Check if an error is an abort error.
 *
 * This handles the various ways abort errors can manifest across different
 * environments (browsers, Node.js, Next.js, etc.).
 *
 * @param error - The error to check
 * @returns True if the error is an abort error
 */
export function isAbortError(error: unknown): error is Error {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    (error.name === 'AbortError' ||
      error.name === 'ResponseAborted' || // Next.js
      error.name === 'TimeoutError')
  );
}
