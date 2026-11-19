import type { ToolHandler, ToolSchema } from '@octavus/core';
import { NAMESPACE_SEPARATOR, type McpDiagnostics } from './entries';

export type EntryStatus = 'connected' | 'degraded';

/**
 * The status tool of an MCP entry: one definition whatever the entry's state,
 * so the tool list the model sees does not change when the entry connects,
 * degrades, or recovers. The state travels in the tool's result: whether the
 * capability is available and its tools, or what is wrong and how to fix it.
 */
export function createStatusTool(
  namespace: string,
  status: EntryStatus,
  toolNames: string[],
  error?: string,
  diagnostics?: McpDiagnostics,
): { handler: ToolHandler; schema: ToolSchema } {
  const toolName = `${namespace}${NAMESPACE_SEPARATOR}status`;

  const schema: ToolSchema = {
    name: toolName,
    description: `Check the health of the ${namespace} capability: whether it is available and which tools it offers, or, when it is unavailable, what is wrong and how to fix it.`,
    inputSchema: { type: 'object', properties: {} },
  };

  const handler: ToolHandler = () => {
    if (status === 'degraded') {
      return Promise.resolve({
        status: 'unavailable',
        error: error ?? 'Unknown error',
        ...(diagnostics &&
          diagnostics.prerequisites.length > 0 && {
            prerequisites: diagnostics.prerequisites,
          }),
        ...(diagnostics &&
          diagnostics.suggestedFixes.length > 0 && {
            suggestedFixes: diagnostics.suggestedFixes,
          }),
      });
    }

    return Promise.resolve({
      status: 'connected',
      tools: toolNames,
    });
  };

  return { handler, schema };
}
