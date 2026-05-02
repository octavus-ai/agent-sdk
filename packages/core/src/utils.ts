/**
 * Generate a unique ID for messages, tool calls, etc.
 * Format: timestamp-random (e.g., "1702345678901-abc123def")
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Ensures a tool `inputSchema` has a `properties` field on its root object
 * node and on any nested schema reachable through `properties`. OpenAI
 * rejects tool schemas that declare `type: "object"` without `properties`;
 * Anthropic and Google are lenient. This normalizer acts as a safety net
 * for schemas coming from MCP servers or hand-crafted definitions that may
 * not satisfy OpenAI's stricter validation.
 *
 * Scope: walks `type: "object"` nodes through the `properties` map. It does
 * not descend into `items`, `additionalProperties`, `anyOf`/`oneOf`/`allOf`,
 * or `$defs` - those are uncommon at the top level of tool inputs. Expand
 * here if a real-world schema surfaces the gap.
 */
export function normalizeToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
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
          ? normalizeToolInputSchema(value as Record<string, unknown>)
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
