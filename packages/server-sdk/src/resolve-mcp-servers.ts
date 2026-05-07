import type { InlineMcpServer, ToolHandlers, ToolSchema } from '@octavus/core';

export interface ResolvedMcpServers {
  toolHandlers: ToolHandlers;
  dynamicToolSchemas: ToolSchema[];
}

/**
 * Resolve inline MCP servers into merged tool handlers and dynamic tool schemas.
 * Validates namespace uniqueness, handler name collisions, and schema name
 * collisions across MCPs and any preexisting dynamic schemas.
 */
export function resolveMcpServers(
  mcpServers: InlineMcpServer[],
  staticTools?: ToolHandlers,
  existingDynamicSchemas?: ToolSchema[],
): ResolvedMcpServers {
  const seenNamespaces = new Set<string>();
  const mergedHandlers: ToolHandlers = { ...staticTools };
  const mergedSchemas: ToolSchema[] = existingDynamicSchemas ? [...existingDynamicSchemas] : [];
  const seenSchemaNames = new Set(mergedSchemas.map((s) => s.name));

  for (const mcp of mcpServers) {
    if (seenNamespaces.has(mcp.namespace)) {
      throw new Error(
        `Duplicate MCP namespace "${mcp.namespace}". Each inline MCP server must have a unique namespace.`,
      );
    }
    seenNamespaces.add(mcp.namespace);

    const mcpHandlers = mcp.toolHandlers();
    const mcpSchemas = mcp.toolSchemas();

    for (const [toolName, handler] of Object.entries(mcpHandlers)) {
      if (mergedHandlers[toolName]) {
        throw new Error(
          `Tool name collision: "${toolName}" is already registered. ` +
            'Ensure no overlap between MCP-namespaced tools and static tool handlers.',
        );
      }
      mergedHandlers[toolName] = handler;
    }

    for (const schema of mcpSchemas) {
      if (seenSchemaNames.has(schema.name)) {
        throw new Error(
          `Tool schema name collision: "${schema.name}" is already registered as a dynamic tool schema.`,
        );
      }
      seenSchemaNames.add(schema.name);
      mergedSchemas.push(schema);
    }
  }

  return { toolHandlers: mergedHandlers, dynamicToolSchemas: mergedSchemas };
}
