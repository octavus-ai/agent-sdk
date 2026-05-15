import type { FileReference } from './stream/types';

export type McpToolResultProjectionSource =
  | 'structuredContent'
  | 'jsonText'
  | 'text'
  | 'content'
  | 'empty'
  | 'error';

export interface McpContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface McpToolResultValidation {
  valid: boolean;
  error?: string;
}

export interface McpToolResultProjection {
  source: McpToolResultProjectionSource;
  errorText?: string;
}

export interface McpToolResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  projection?: McpToolResultProjection;
  validation?: McpToolResultValidation;
}

export interface McpToolResultPayload {
  result: unknown;
  error?: string;
  files?: FileReference[];
  mcp: McpToolResult;
}

export interface McpStructuredContentValidationContext {
  structuredContent: Record<string, unknown> | undefined;
  outputSchema: Record<string, unknown>;
}

export interface NormalizeMcpToolResultOptions {
  outputSchema?: Record<string, unknown>;
  validateStructuredContent?: (
    context: McpStructuredContentValidationContext,
  ) => McpToolResultValidation;
}

interface CallToolResultLike {
  content?: unknown;
  structuredContent?: unknown;
  isError?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeContentBlock(part: unknown): McpContentBlock {
  if (isRecord(part) && typeof part.type === 'string') {
    return part as McpContentBlock;
  }
  return { type: 'unknown', value: part };
}

function normalizeContent(content: unknown): McpContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.map(normalizeContentBlock);
}

function extractTextContent(content: McpContentBlock[]): string[] {
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string);
}

function buildErrorText(content: McpContentBlock[]): string {
  return extractTextContent(content).join('\n') || 'Tool execution failed';
}

function projectContent(content: McpContentBlock[]): {
  result: unknown;
  source: McpToolResultProjectionSource;
} {
  if (content.length === 0) {
    return { result: { success: true }, source: 'empty' };
  }

  const textParts = extractTextContent(content);
  const hasNonText = content.some((part) => part.type !== 'text');

  if (!hasNonText) {
    if (textParts.length === 1) {
      try {
        return { result: JSON.parse(textParts[0]!), source: 'jsonText' };
      } catch {
        return { result: textParts[0], source: 'text' };
      }
    }
    return { result: textParts.join('\n'), source: 'text' };
  }

  return {
    result: content.map((part) => {
      if (part.type === 'text' && typeof part.text === 'string') return part.text;
      return part;
    }),
    source: 'content',
  };
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function schemaTypes(schema: Record<string, unknown>): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type))
    return schema.type.filter((type): type is string => typeof type === 'string');
  return [];
}

function matchesSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'null':
      return value === null;
    case 'number':
      return typeof value === 'number';
    case 'object':
      return isRecord(value);
    case 'string':
      return typeof value === 'string';
    default:
      return true;
  }
}

function validateAgainstJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$',
): string[] {
  const errors: string[] = [];
  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => matchesSchemaType(value, type))) {
    errors.push(`${path} must be ${types.join(' or ')}, received ${describeType(value)}`);
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => Object.is(allowed, value))) {
    errors.push(`${path} must be one of ${schema.enum.map(String).join(', ')}`);
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }

    if (isRecord(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (!(key in value) || !isRecord(childSchema)) continue;
        errors.push(...validateAgainstJsonSchema(value[key], childSchema, `${path}.${key}`));
      }
    }

    if (schema.additionalProperties === false && isRecord(schema.properties)) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (Array.isArray(value) && isRecord(schema.items)) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateAgainstJsonSchema(value[i], schema.items, `${path}[${i}]`));
    }
  }

  return errors;
}

function validateStructuredContentAgainstOutputSchema(
  structuredContent: Record<string, unknown> | undefined,
  outputSchema: Record<string, unknown>,
): McpToolResultValidation {
  if (structuredContent === undefined) {
    return {
      valid: false,
      error: 'Tool declared an output schema but did not return structuredContent.',
    };
  }

  const errors = validateAgainstJsonSchema(structuredContent, outputSchema);
  return errors.length === 0
    ? { valid: true }
    : { valid: false, error: errors.slice(0, 5).join('; ') };
}

export function normalizeMcpToolResult(
  rawResult: unknown,
  options: NormalizeMcpToolResultOptions = {},
): McpToolResultPayload {
  const callResult = isRecord(rawResult) ? (rawResult as CallToolResultLike) : {};
  const content = normalizeContent(callResult.content);
  const structuredContent = isRecord(callResult.structuredContent)
    ? callResult.structuredContent
    : undefined;
  const isError = callResult.isError === true;

  const mcp: McpToolResult = {
    content,
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };

  if (options.outputSchema) {
    mcp.validation = options.validateStructuredContent
      ? options.validateStructuredContent({
          structuredContent,
          outputSchema: options.outputSchema,
        })
      : validateStructuredContentAgainstOutputSchema(structuredContent, options.outputSchema);

    if (!mcp.validation.valid) {
      const errorText = mcp.validation.error ?? 'Tool structuredContent failed validation.';
      mcp.isError = true;
      mcp.projection = { source: 'error', errorText };
      return {
        result: { error: errorText },
        error: errorText,
        mcp,
      };
    }
  }

  if (isError) {
    const errorText = buildErrorText(content);
    mcp.projection = { source: 'error', errorText };
    return {
      result: { error: errorText },
      error: errorText,
      mcp,
    };
  }

  if (structuredContent !== undefined) {
    mcp.projection = { source: 'structuredContent' };
    return { result: structuredContent, mcp };
  }

  const projection = projectContent(content);
  mcp.projection = { source: projection.source };
  return { result: projection.result, mcp };
}

export function isMcpToolResultPayload(value: unknown): value is McpToolResultPayload {
  return (
    isRecord(value) && isRecord(value.mcp) && Array.isArray(value.mcp.content) && 'result' in value
  );
}
