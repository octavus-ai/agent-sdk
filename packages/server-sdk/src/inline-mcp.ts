import { type z, toJSONSchema } from 'zod';
import type { InlineMcpServer, ToolHandler, ToolSchema } from '@octavus/core';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
 * Tool name format. Mirrors the right-hand side of the platform's
 * MCP-namespaced tool name pattern so the resulting `${namespace}__${tool}`
 * matches what the runtime and LLM providers accept.
 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

interface InlineMcpToolDefinition<
  T extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  description: string;
  parameters: T;
  output?: O;
  handler: (args: z.infer<T>) => Promise<z.infer<O>>;
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

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Define a single inline MCP tool with type-safe handler arguments.
 *
 * Wrapping each tool in `defineInlineMcpTool()` is what gives the handler
 * its inferred argument type from the Zod schema. Without this wrapper,
 * TypeScript collapses the per-tool generic when the tools are placed in
 * a record literal, leaving `args` typed as `unknown`.
 *
 * Optionally pass an `output` Zod schema to declare the tool's return shape.
 * When set, the schema is forwarded to the LLM as `outputSchema` (used by
 * providers that support structured tool outputs, e.g. OpenAI strict mode)
 * and handler return values are validated at runtime - a handler that
 * returns a malformed result throws before reaching the LLM. Omitting
 * `output` preserves the previous unconstrained-return behavior.
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
export function defineInlineMcpTool<T extends z.ZodType, O extends z.ZodType = z.ZodType>(
  def: InlineMcpToolDefinition<T, O>,
): InlineMcpToolDefinition<T, O> {
  return def;
}

/**
 * Create an inline MCP server with Zod-typed tools.
 *
 * Tools are namespaced with `namespace__toolName` and execute in the consumer's
 * process via the tool-request/continue pattern. Zod schemas are converted to
 * JSON Schema once at creation time.
 *
 * Note on naming: the protocol declares these MCP servers with `source: consumer`
 * (the consumer owns the integration). "Inline" refers to where execution happens
 * (in-process via the consumer's SDK), distinguishing this from a future
 * `createRemoteMcpServer()` where the consumer hosts an HTTP MCP endpoint.
 *
 * Wrap each tool entry in `defineInlineMcpTool()` so the handler argument types
 * are inferred from the Zod schema. Without the wrapper TypeScript collapses
 * the per-tool generic and `args` ends up typed as `unknown`.
 *
 * @param namespace - Unique namespace for this MCP server (e.g., 'github', 'gong')
 * @param config - Tool definitions with Zod schemas and handlers
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

    const inputJsonSchema = toJSONSchema(def.parameters) as Record<string, unknown>;
    const outputJsonSchema = def.output
      ? (toJSONSchema(def.output) as Record<string, unknown>)
      : undefined;

    schemas.push({
      name: namespacedName,
      description: def.description,
      inputSchema: inputJsonSchema,
      outputSchema: outputJsonSchema,
    });

    const zodSchema = def.parameters;
    const outputZodSchema = def.output;
    handlers[namespacedName] = async (args: Record<string, unknown>) => {
      const parsed = zodSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for "${namespacedName}": ${formatZodIssues(parsed.error)}`,
        );
      }
      const result = await def.handler(parsed.data);
      if (outputZodSchema) {
        const validated = outputZodSchema.safeParse(result);
        if (!validated.success) {
          throw new Error(
            `Invalid output from "${namespacedName}": ${formatZodIssues(validated.error)}`,
          );
        }
        return validated.data;
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
