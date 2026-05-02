import type { ToolHandler, ToolSchema } from '@octavus/core';
import { NAMESPACE_SEPARATOR, type McpDiagnostics } from './entries';

export type EntryStatus = 'connected' | 'degraded';

export function createStatusTool(
  namespace: string,
  status: EntryStatus,
  toolNames: string[],
  error?: string,
  diagnostics?: McpDiagnostics,
): { handler: ToolHandler; schema: ToolSchema } {
  const toolName = `${namespace}${NAMESPACE_SEPARATOR}status`;

  const description =
    status === 'degraded'
      ? `The ${namespace} capability is currently unavailable. Call this tool to diagnose the issue and get fix instructions.`
      : `Check the health of the ${namespace} capability and list available tools.`;

  const schema: ToolSchema = {
    name: toolName,
    description,
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
