import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  normalizeMcpToolResult,
  normalizeToolInputSchema,
  type ToolHandler,
  type ToolSchema,
} from '@octavus/core';
import { NAMESPACE_SEPARATOR, type StdioConfig, type HttpConfig } from './entries';

const MCP_CLIENT_NAME = 'octavus-computer';
const MCP_CLIENT_VERSION = '1.0.0';

export interface McpConnection {
  client: Client;
  namespace: string;
  handlers: Record<string, ToolHandler>;
  schemas: ToolSchema[];
  close: () => Promise<void>;
  ping: () => Promise<void>;
}

function namespaceTool(namespace: string, toolName: string): string {
  return `${namespace}${NAMESPACE_SEPARATOR}${toolName}`;
}

async function discoverTools(
  client: Client,
  namespace: string,
): Promise<Pick<McpConnection, 'handlers' | 'schemas'>> {
  const { tools } = await client.listTools();

  const handlers: Record<string, ToolHandler> = {};
  const schemas: ToolSchema[] = [];

  for (const tool of tools) {
    const nsName = namespaceTool(namespace, tool.name);
    const originalName = tool.name;

    schemas.push({
      name: nsName,
      description: tool.description ?? originalName,
      inputSchema: normalizeToolInputSchema(tool.inputSchema as Record<string, unknown>),
      ...(tool.outputSchema && {
        outputSchema: tool.outputSchema as Record<string, unknown>,
      }),
    });

    handlers[nsName] = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: originalName, arguments: args });
      return normalizeMcpToolResult(result, {
        outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
      });
    };
  }

  return { handlers, schemas };
}

async function connect(namespace: string, transport: Transport): Promise<McpConnection> {
  const client = new Client({ name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION });
  await client.connect(transport);
  const { handlers, schemas } = await discoverTools(client, namespace);
  return {
    client,
    namespace,
    handlers,
    schemas,
    close: () => client.close(),
    ping: async () => {
      await client.ping();
    },
  };
}

export function connectStdio(namespace: string, config: StdioConfig): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    stderr: 'pipe',
  });

  return connect(namespace, transport);
}

export function connectHttp(namespace: string, config: HttpConfig): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  return connect(namespace, transport);
}
