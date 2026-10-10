import type { Stream } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { normalizeToolInputSchema, type ToolHandler, type ToolSchema } from '@octavus/core';
import { NAMESPACE_SEPARATOR, type StdioConfig, type HttpConfig } from './entries';

const MCP_CLIENT_NAME = 'octavus-computer';
const MCP_CLIENT_VERSION = '1.0.0';

/**
 * How much of a STDIO server's recent stderr to keep for diagnostics. A server
 * that fails to start prints its reason there (what it could not launch, what
 * never connected) just before exiting, and a few lines carry it; the bound
 * keeps a chatty server from growing the tail without limit.
 */
const STDERR_TAIL_MAX_LINES = 8;
const STDERR_TAIL_MAX_CHARS = 2_000;
/**
 * A stack-frame line (`    at fn (file:line:col)`), excluded from the tail. A
 * Node server that logs a fatal error prints its message once and then one frame
 * per line, so a tail that kept frames would hold only frames for any failure
 * with a deeper stack than the bound - pushing out the one line that says why.
 */
const STDERR_STACK_FRAME_LINE = /^\s+at\s/;

/**
 * Upper bound for a single device tool call. A wedged tool (frozen browser
 * tab, hung STDIO MCP) otherwise never returns, stalling the whole run with no
 * result. On timeout the MCP client rejects, the caller turns that into a tool
 * error, and the agent recovers (retry/move on) instead of hanging. `timeout`
 * caps an idle call; `maxTotalTimeout` is the hard ceiling so streamed progress
 * notifications can never extend it indefinitely (`resetTimeoutOnProgress`
 * stays off as well). Shell runs in-process with its own timeout, so this only
 * bounds MCP-backed device tools; the server SDK's stream inactivity watchdog
 * separately covers the platform round-trip.
 */
const TOOL_CALL_TIMEOUT_MS = 120_000;

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

interface ContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface CallToolResult {
  content?: ContentPart[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

function formatContentPart(part: ContentPart): unknown {
  if (part.type === 'text' && typeof part.text === 'string') {
    return part.text;
  }
  // Preserve non-text content (images, audio, resources) as structured data
  // so downstream consumers can handle them appropriately.
  return part;
}

function formatCallToolResult(result: CallToolResult): unknown {
  if (result.isError) {
    const errorText = (result.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text!)
      .join('\n');
    return { error: errorText || 'Tool execution failed' };
  }

  // Prefer structuredContent over content[] when both are present. Per the
  // MCP spec, content[] sent alongside structuredContent is a JSON-stringified
  // fallback for clients that don't understand structured results, so the
  // structured object is the canonical representation for the LLM.
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }

  const content = result.content ?? [];

  if (content.length === 0) {
    return { success: true };
  }

  const textParts = content.filter((c) => c.type === 'text' && typeof c.text === 'string');
  const hasNonText = content.some((c) => c.type !== 'text');

  if (!hasNonText) {
    if (textParts.length === 1) {
      try {
        return JSON.parse(textParts[0]!.text!);
      } catch {
        return textParts[0]!.text;
      }
    }
    return textParts.map((p) => p.text).join('\n');
  }

  return content.map(formatContentPart);
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
      outputSchema: tool.outputSchema
        ? normalizeToolInputSchema(tool.outputSchema as Record<string, unknown>)
        : undefined,
    });

    handlers[nsName] = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: originalName, arguments: args }, undefined, {
        timeout: TOOL_CALL_TIMEOUT_MS,
        maxTotalTimeout: TOOL_CALL_TIMEOUT_MS,
        resetTimeoutOnProgress: false,
      });
      return formatCallToolResult(result as CallToolResult);
    };
  }

  return { handlers, schemas };
}

async function connect(
  namespace: string,
  transport: Transport,
  describeFailure?: (err: unknown) => string | undefined,
): Promise<McpConnection> {
  const client = new Client({ name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION });
  try {
    await client.connect(transport);
  } catch (err) {
    const detail = describeFailure?.(err);
    if (detail) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}: ${detail}`, {
        cause: err,
      });
    }
    throw err;
  }
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

/**
 * Keep a bounded tail of a stream's text so the last thing a server wrote can be
 * attached to a failure. Attaching a consumer also keeps the pipe drained: an
 * unread piped stderr fills its buffer and then blocks the server's own writes.
 */
function tailStream(stream: Stream | null): () => string {
  if (!stream) return () => '';
  let lines: string[] = [];
  let partial = '';
  stream.on('data', (chunk: Buffer | string) => {
    const text = partial + String(chunk);
    const parts = text.split(/\r?\n/);
    partial = parts.pop() ?? '';
    const complete = diagnosticLines(parts);
    if (complete.length > 0) {
      lines = [...lines, ...complete].slice(-STDERR_TAIL_MAX_LINES);
    }
  });
  stream.on('error', () => {
    // The tail is diagnostics only; a broken pipe is not a connection failure.
  });
  return () => {
    const all = [...lines, ...diagnosticLines([partial])];
    const joined = all.slice(-STDERR_TAIL_MAX_LINES).join(' | ');
    return joined.length > STDERR_TAIL_MAX_CHARS ? joined.slice(-STDERR_TAIL_MAX_CHARS) : joined;
  };
}

/** The lines of a tail worth keeping: non-empty, and not stack frames. */
function diagnosticLines(raw: string[]): string[] {
  return raw
    .filter((line) => !STDERR_STACK_FRAME_LINE.test(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function connectStdio(namespace: string, config: StdioConfig): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    stderr: 'pipe',
  });
  // The piped stderr is available before the process starts, so nothing the
  // server prints while failing to start is lost; a connect failure then carries
  // the server's own reason instead of only the client's "Connection closed".
  const stderrTail = tailStream(transport.stderr);

  return connect(namespace, transport, () => stderrTail() || undefined);
}

export function connectHttp(namespace: string, config: HttpConfig): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  return connect(namespace, transport);
}
