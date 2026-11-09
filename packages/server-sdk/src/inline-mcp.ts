import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { DisplayMode, InlineMcpServer, ToolHandler, ToolSchema } from '@octavus/core';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
 * Tool name format. Mirrors the right-hand side of the platform's
 * MCP-namespaced tool name pattern so the resulting `${namespace}__${tool}`
 * matches what the runtime and LLM providers accept.
 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * A schema an inline MCP tool takes: one that validates values (Standard
 * Schema) and converts itself to JSON Schema (Standard JSON Schema), as every
 * Zod schema does from zod 4.2. The SDK calls the schema's own methods, so it
 * never depends on the consumer's copy or version of the schema library.
 */
type InlineMcpToolSchema = StandardSchemaV1 & StandardJSONSchemaV1;

interface InlineMcpToolDefinition<
  T extends InlineMcpToolSchema = InlineMcpToolSchema,
  O extends InlineMcpToolSchema = InlineMcpToolSchema,
> {
  description: string;
  /**
   * Optional user-facing label for this tool's execution card, shown in every
   * visible display mode. Overrides the namespace-level `mcpServers.<ns>.title`
   * for this tool only; `description` stays model-facing.
   */
  title?: string;
  /**
   * Optional per-tool display mode, overriding the namespace-level `display`.
   * Unset falls back to the namespace mode, then the runtime default.
   */
  display?: DisplayMode;
  parameters: T;
  output?: O;
  /** A method, so a tools record can hold tools whose arguments differ. */
  handler(args: StandardSchemaV1.InferOutput<T>): Promise<StandardSchemaV1.InferOutput<O>>;
}

interface InlineMcpServerConfig {
  tools: Record<string, InlineMcpToolDefinition>;
}

function validateNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      `Invalid MCP namespace "${namespace}". Must contain only lowercase letters, digits, and hyphens, and start with a letter.`,
    );
  }
}

function validateToolName(toolName: string, namespace: string): void {
  if (!TOOL_NAME_PATTERN.test(toolName)) {
    throw new Error(
      `Invalid MCP tool name "${toolName}" in namespace "${namespace}". Must contain only lowercase letters, digits, underscores, and hyphens, and start with a letter.`,
    );
  }
}

function isInlineMcpToolSchema(value: unknown): value is InlineMcpToolSchema {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (!('~standard' in value)) return false;
  const standard = value['~standard'] as Partial<InlineMcpToolSchema['~standard']> | undefined;
  return (
    typeof standard?.validate === 'function' && typeof standard.jsonSchema?.output === 'function'
  );
}

/**
 * Converts on the output side, the shape the handler receives: a defaulted
 * field stays required and `additionalProperties: false` is kept, both of
 * which the input side would lose.
 */
function toolJsonSchema(
  schema: unknown,
  field: 'parameters' | 'output',
  namespacedName: string,
): Record<string, unknown> {
  if (!isInlineMcpToolSchema(schema)) {
    throw new Error(
      `Invalid ${field} schema for MCP tool "${namespacedName}". Must implement Standard JSON Schema, as Zod schemas do from zod 4.2.`,
    );
  }
  return schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' });
}

function formatIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? []).map((segment) =>
        String(typeof segment === 'object' ? segment.key : segment),
      );
      return `${path.length > 0 ? path.join('.') : '<root>'}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Define a single inline MCP tool with type-safe handler arguments.
 *
 * Wrapping each tool in `defineInlineMcpTool()` is what gives the handler
 * its inferred argument type from the schema. Without this wrapper,
 * TypeScript collapses the per-tool generic when the tools are placed in
 * a record literal, leaving `args` typed as `unknown`.
 *
 * `parameters` and `output` take any schema that implements Standard JSON
 * Schema, such as a Zod schema (zod 4.2 or newer).
 *
 * Optionally pass an `output` schema to declare the tool's return shape.
 * When set, the schema is forwarded to the LLM as `outputSchema` (used by
 * providers that support structured tool outputs, e.g. OpenAI strict mode)
 * and handler return values are validated at runtime - a handler that
 * returns a malformed result throws before reaching the LLM. Without
 * `output`, the return value is unconstrained.
 *
 * @example
 * ```typescript
 * const getPrOverview = defineInlineMcpTool({
 *   description: 'Get pull request metadata and file changes',
 *   parameters: z.object({
 *     owner: z.string(),
 *     repo: z.string(),
 *     pullNumber: z.number(),
 *   }),
 *   output: z.object({
 *     title: z.string(),
 *     state: z.enum(['open', 'closed', 'merged']),
 *     additions: z.number(),
 *     deletions: z.number(),
 *   }),
 *   handler: async (args) => {
 *     // args is { owner: string; repo: string; pullNumber: number }
 *     // return value is type-checked against the `output` schema
 *     return await githubService.getPrOverview(args.owner, args.repo, args.pullNumber);
 *   },
 * });
 * ```
 */
export function defineInlineMcpTool<
  T extends InlineMcpToolSchema,
  O extends InlineMcpToolSchema = InlineMcpToolSchema,
>(def: InlineMcpToolDefinition<T, O>): InlineMcpToolDefinition<T, O> {
  return def;
}

/**
 * Create an inline MCP server from typed tool definitions.
 *
 * Tools are namespaced with `namespace__toolName` and execute in the consumer's
 * process via the tool-request/continue pattern. Each tool's schemas are
 * converted to JSON Schema once at creation time.
 *
 * Note on naming: the protocol declares these MCP servers with `source: consumer`
 * (the consumer owns the integration). "Inline" refers to where execution happens:
 * in-process, via the consumer's SDK, rather than at an HTTP MCP endpoint the
 * consumer hosts.
 *
 * Wrap each tool entry in `defineInlineMcpTool()` so the handler argument types
 * are inferred from the schema. Without the wrapper TypeScript collapses
 * the per-tool generic and `args` ends up typed as `unknown`.
 *
 * @param namespace - Unique namespace for this MCP server (e.g., 'github', 'gong')
 * @param config - Tool definitions with their schemas and handlers
 *
 * @example
 * ```typescript
 * const github = createInlineMcpServer('github', {
 *   tools: {
 *     'get-pr-overview': defineInlineMcpTool({
 *       description: 'Get pull request metadata and file changes',
 *       parameters: z.object({
 *         owner: z.string(),
 *         repo: z.string(),
 *         pullNumber: z.number(),
 *       }),
 *       handler: async (args) => {
 *         return await githubService.getPrOverview(token, args.owner, args.repo, args.pullNumber);
 *       },
 *     }),
 *   },
 * });
 *
 * const { output } = await client.workers.generate(agentId, input, {
 *   mcpServers: [github],
 * });
 * ```
 */
export function createInlineMcpServer(
  namespace: string,
  config: InlineMcpServerConfig,
): InlineMcpServer {
  validateNamespace(namespace);

  const schemas: ToolSchema[] = [];
  const handlers: Record<string, ToolHandler> = {};

  for (const [toolName, def] of Object.entries(config.tools)) {
    validateToolName(toolName, namespace);
    const namespacedName = `${namespace}__${toolName}`;

    const inputJsonSchema = toolJsonSchema(def.parameters, 'parameters', namespacedName);
    const outputJsonSchema = def.output
      ? toolJsonSchema(def.output, 'output', namespacedName)
      : undefined;

    schemas.push({
      name: namespacedName,
      description: def.description,
      inputSchema: inputJsonSchema,
      outputSchema: outputJsonSchema,
      ...(def.title !== undefined ? { title: def.title } : {}),
      ...(def.display !== undefined ? { display: def.display } : {}),
    });

    const { parameters, output } = def;
    handlers[namespacedName] = async (args: Record<string, unknown>) => {
      const parsed = await parameters['~standard'].validate(args);
      if (parsed.issues) {
        throw new Error(
          `Invalid arguments for "${namespacedName}": ${formatIssues(parsed.issues)}`,
        );
      }
      const result = await def.handler(parsed.value);
      if (output) {
        const validated = await output['~standard'].validate(result);
        if (validated.issues) {
          throw new Error(
            `Invalid output from "${namespacedName}": ${formatIssues(validated.issues)}`,
          );
        }
        return validated.value;
      }
      return result;
    };
  }

  return {
    namespace,
    toolSchemas: () => schemas,
    toolHandlers: () => handlers,
  };
}
