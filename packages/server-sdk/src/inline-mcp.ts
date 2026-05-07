import { type z, toJSONSchema } from 'zod';
import type { InlineMcpServer, ToolHandler, ToolSchema } from '@octavus/core';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
 * Tool name format. Mirrors the right-hand side of the platform's
 * MCP-namespaced tool name pattern so the resulting `${namespace}__${tool}`
 * matches what the runtime and LLM providers accept.
 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

interface InlineMcpToolDefinition<T extends z.ZodType = z.ZodType> {
  description: string;
  parameters: T;
  handler: (args: z.infer<T>) => Promise<unknown>;
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
 * @example
 * ```typescript
 * const getPrOverview = defineInlineMcpTool({
 *   description: 'Get pull request metadata and file changes',
 *   parameters: z.object({
 *     owner: z.string(),
 *     repo: z.string(),
 *     pullNumber: z.number(),
 *   }),
 *   handler: async (args) => {
 *     // args is { owner: string; repo: string; pullNumber: number }
 *     return await githubService.getPrOverview(args.owner, args.repo, args.pullNumber);
 *   },
 * });
 * ```
 */
export function defineInlineMcpTool<T extends z.ZodType>(
  def: InlineMcpToolDefinition<T>,
): InlineMcpToolDefinition<T> {
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

    const jsonSchema = toJSONSchema(def.parameters) as Record<string, unknown>;

    schemas.push({
      name: namespacedName,
      description: def.description,
      inputSchema: jsonSchema,
    });

    const zodSchema = def.parameters;
    handlers[namespacedName] = async (args: Record<string, unknown>) => {
      const parsed = zodSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid arguments for "${namespacedName}": ${formatZodIssues(parsed.error)}`,
        );
      }
      return await def.handler(parsed.data);
    };
  }

  return {
    namespace,
    toolSchemas: () => schemas,
    toolHandlers: () => handlers,
  };
}
