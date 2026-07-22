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
 * Three independent concerns, each of which can otherwise 400 a whole request -
 * every tool schema is sent to the provider in one array, so a single offending
 * tool takes down the entire agent loop, not just that tool:
 *
 * 1. Top-level `oneOf`/`anyOf`/`allOf` - rejected by Anthropic. Flattened into
 *    a plain object schema (see {@link flattenTopLevelCombinators}).
 * 2. A `type: "object"` node missing `properties` - rejected by OpenAI
 *    (Anthropic and Google are lenient). A `properties: {}` is filled in.
 * 3. A `pattern` whose regex uses a feature the provider's validator can't
 *    compile - OpenAI's RE2-style validator (and Anthropic in strict mode)
 *    reject lookaround and backreferences with "regex lookaround is not
 *    supported", even though JSON Schema (ECMA-262) permits them. The offending
 *    `pattern` is stripped (see {@link UNSUPPORTED_PATTERN_FEATURES}); it is
 *    advisory, so nothing is lost at execution time - the MCP server still
 *    validates the argument when the tool is actually called.
 *
 * Applies equally to tool `inputSchema` and `outputSchema` - the body is
 * schema-shape agnostic; the name reflects the original use site only.
 *
 * Concerns 2 and 3 walk the ENTIRE schema tree: every subschema reachable
 * through `properties`, `items`/`prefixItems`, `additionalProperties`,
 * `patternProperties`, `$defs`/`definitions`, the `allOf`/`anyOf`/`oneOf`
 * branches, `not`, `if`/`then`/`else`, `contains`, `propertyNames`, and
 * `dependentSchemas`. Only the ROOT combinator is flattened (for Anthropic);
 * nested combinators are left intact because every provider supports them.
 */
export function normalizeToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSchemaNode(flattenTopLevelCombinators(schema)) as Record<string, unknown>;
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

/**
 * Regex features that OpenAI's tool-schema validator (an RE2-style subset) and
 * other constrained decoders (e.g. Anthropic in strict mode) reject outright,
 * 400-ing the whole request. JSON Schema (ECMA-262) permits them, but a tool
 * `pattern` that uses one - most commonly an email-format regex with a
 * lookahead - makes the tool unusable with those providers. Matched as
 * substrings of the pattern, so the check is cheap and provider-agnostic; a
 * rare false positive only drops an advisory constraint the MCP server still
 * enforces at call time. Extend this list if a new unsupported construct
 * surfaces in the wild.
 */
const UNSUPPORTED_PATTERN_FEATURES: readonly RegExp[] = [
  /\(\?=/, // positive lookahead
  /\(\?!/, // negative lookahead
  /\(\?<=/, // positive lookbehind
  /\(\?<!/, // negative lookbehind
  /\\[1-9]/, // numeric backreference
  /\\k[<']/, // named backreference
];

function hasUnsupportedRegexFeature(pattern: string): boolean {
  return UNSUPPORTED_PATTERN_FEATURES.some((feature) => feature.test(pattern));
}

/** Keywords whose value is a single subschema. */
const SUBSCHEMA_KEYS = [
  'items',
  'additionalProperties',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'not',
  'unevaluatedItems',
  'unevaluatedProperties',
] as const;

/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_LIST_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;

/** Keywords whose value is a map of name -> subschema. */
const SUBSCHEMA_MAP_KEYS = [
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
] as const;

/**
 * Recursively normalize a schema node: fill missing `properties` on object
 * nodes (concern 2) and strip provider-incompatible `pattern`s (concern 3),
 * then descend through every subschema-bearing keyword. Structural only - it
 * never resolves `$ref`, so `$ref` cycles cannot loop it. Non-object/array
 * values pass through untouched.
 */
function sanitizeSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitizeSchemaNode);
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }

  const result = { ...(node as Record<string, unknown>) };

  if (result.type === 'object' && !('properties' in result)) {
    result.properties = {};
  }

  if (typeof result.pattern === 'string' && hasUnsupportedRegexFeature(result.pattern)) {
    delete result.pattern;
  }

  for (const key of SUBSCHEMA_KEYS) {
    if (key in result) {
      result[key] = sanitizeSchemaNode(result[key]);
    }
  }

  for (const key of SUBSCHEMA_LIST_KEYS) {
    const value = result[key];
    if (Array.isArray(value)) {
      result[key] = value.map(sanitizeSchemaNode);
    }
  }

  for (const key of SUBSCHEMA_MAP_KEYS) {
    const value = result[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const sanitized: Record<string, unknown> = {};
      for (const [name, subSchema] of Object.entries(value as Record<string, unknown>)) {
        sanitized[name] = sanitizeSchemaNode(subSchema);
      }
      result[key] = sanitized;
    }
  }

  return result;
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
