import type { ToolResult } from '@octavus/core';

/**
 * Default ceiling for a single continuation request body. The platform caps the
 * size of an inbound request body; a larger body is rejected with a 413 before
 * the request is handled (so server-side error handling never runs). We keep the
 * whole body under 4 MiB, leaving headroom for JSON envelope overhead and the
 * non-`toolResults` fields.
 */
export const MAX_CONTINUATION_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Headroom reserved for body fields other than `toolResults` (dynamic tool
 * schemas, executionId, sender, JSON structure) so the guard budgets the tool
 * results against a slightly smaller ceiling than the whole-body cap.
 */
export const CONTINUATION_BODY_RESERVE_BYTES = 256 * 1024;

/**
 * A result whose serialized content is already at or below this size is left
 * as-is - a preview couldn't shrink it. Measured in UTF-8 bytes, the unit that
 * counts against the wire limit.
 */
const TRUNCATED_RESULT_MIN_BYTES = 16 * 1024;

/**
 * Characters kept in a head+tail preview of an oversized result: small enough
 * to stay trivial on the wire and in the model's context, large enough to
 * remain a useful sample. A multi-MB result overflows the model's context
 * anyway, so a preview plus guidance is more usable than the whole payload.
 * Counted in characters, not bytes, because the preview's exact wire size is
 * irrelevant - the hard per-request limit is enforced separately against the
 * whole request body.
 */
const TRUNCATED_RESULT_PREVIEW_CHARS = 16 * 1024;

/** Describes one tool result the guard reduced, for logging / telemetry. */
export interface ToolResultTruncation {
  toolCallId: string;
  toolName?: string;
  /** UTF-8 byte length of the original serialized content. */
  originalBytes: number;
  /** UTF-8 byte length of the retained preview (or replacement error). */
  keptBytes: number;
  /**
   * True when the oversized result was an `outputVariable` capture that was
   * replaced with an error instead of truncated to a preview - a partial
   * capture would silently corrupt the stored variable.
   */
  variableCapture: boolean;
}

export interface EnforceToolResultsSizeResult {
  /** The (possibly reduced) tool results, safe to send. Never mutates the input. */
  results: ToolResult[] | undefined;
  /** One entry per result that was reduced. Empty when nothing needed reducing. */
  truncations: ToolResultTruncation[];
  /**
   * True when the results still exceed `maxBytes` after reducing every oversized
   * entry (e.g. a pathological number of medium results). Callers should fail
   * loudly rather than send a body that will 413.
   */
  overflow: boolean;
}

const textEncoder = new TextEncoder();

/** UTF-8 byte length of a string - what actually counts against the wire limit. */
export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length;
}

/** Human-readable byte size for guidance messages. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Serialize a tool-result content value the same way it travels on the wire. */
function serializeContent(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function toolResultsByteLength(results: ToolResult[]): number {
  return utf8ByteLength(JSON.stringify(results));
}

/** Serialized size of a single result's dominant content field (result or error). */
function contentByteLength(result: ToolResult): number {
  const raw = result.result !== undefined ? serializeContent(result.result) : (result.error ?? '');
  return utf8ByteLength(raw);
}

/** Head + tail preview of a large string with the middle removed. */
function headTailPreview(raw: string, keepChars: number): string {
  if (raw.length <= keepChars) return raw;
  const head = Math.ceil(keepChars * 0.6);
  const tail = keepChars - head;
  const removed = raw.length - head - tail;
  return `${raw.slice(0, head)}\n\n...[Octavus trimmed ${removed.toLocaleString()} characters]...\n\n${raw.slice(raw.length - tail)}`;
}

/** Index of the result with the largest serialized content, or -1 when empty. */
function largestContentIndex(results: ToolResult[]): number {
  let bestIndex = -1;
  let bestBytes = -1;
  results.forEach((result, index) => {
    const bytes = contentByteLength(result);
    if (bytes > bestBytes) {
      bestBytes = bytes;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/**
 * Reduce a single oversized tool result to a small preview (or, for an
 * `outputVariable` capture, an error). Returns null when the result is already
 * within the preview size and cannot help shrink the payload.
 */
function shrinkResult(target: ToolResult): ToolResultTruncation | null {
  const hasResult = target.result !== undefined;
  const raw = hasResult ? serializeContent(target.result) : (target.error ?? '');
  const originalBytes = utf8ByteLength(raw);
  if (originalBytes <= TRUNCATED_RESULT_MIN_BYTES) return null;

  // A captured variable can't be partially truncated without silently
  // corrupting it, so surface the failure as an error the agent can act on.
  if (hasResult && target.outputVariable) {
    const message =
      `Result omitted: it was ${formatBytes(originalBytes)}, too large to capture into ` +
      `variable "${target.outputVariable}" and send back. Reduce the output - add filters or a ` +
      `limit, request fewer fields, paginate, or write it to a file and return a reference ` +
      `instead of inline data.`;
    target.result = undefined;
    target.error = message;
    return {
      toolCallId: target.toolCallId,
      toolName: target.toolName,
      originalBytes,
      keptBytes: utf8ByteLength(message),
      variableCapture: true,
    };
  }

  const note =
    `[Octavus: this tool result was too large to send (${formatBytes(originalBytes)}), so only ` +
    `the start and end are shown below. To use the full data, reduce the output - add filters or ` +
    `a limit, request fewer fields, paginate, or write it to a file and return a reference ` +
    `instead of inline data.]`;
  const combined = `${note}\n\n${headTailPreview(raw, TRUNCATED_RESULT_PREVIEW_CHARS)}`;
  if (hasResult) {
    target.result = combined;
  } else {
    target.error = combined;
  }
  return {
    toolCallId: target.toolCallId,
    toolName: target.toolName,
    originalBytes,
    keptBytes: utf8ByteLength(combined),
    variableCapture: false,
  };
}

/**
 * Keep a set of tool results under `maxBytes` on the wire by reducing the
 * largest results to head+tail previews (with actionable guidance) until they
 * fit. Pure and non-mutating: the input array and its objects are left
 * untouched; a reduced copy is returned.
 *
 * The motivating failure is a large text tool result (e.g. a big query dump)
 * that a client tries to POST back to the platform continuation endpoint. Media
 * and file outputs are already offloaded to S3 before this runs; inline text is
 * what remains and blows the limit.
 */
export function enforceToolResultsSize(
  results: ToolResult[] | undefined,
  maxBytes: number,
): EnforceToolResultsSizeResult {
  if (!results || results.length === 0) {
    return { results, truncations: [], overflow: false };
  }
  if (toolResultsByteLength(results) <= maxBytes) {
    return { results, truncations: [], overflow: false };
  }

  // Copy so we never mutate the caller's results.
  const working = results.map((result) => ({ ...result }));
  const truncations: ToolResultTruncation[] = [];

  // Reduce the largest content entry to a preview, repeating until the set fits
  // or no oversized entry remains. Bounded by the number of results so it always
  // terminates.
  let remainingPasses = working.length;
  while (remainingPasses > 0 && toolResultsByteLength(working) > maxBytes) {
    remainingPasses -= 1;
    const index = largestContentIndex(working);
    if (index < 0) break;
    const truncation = shrinkResult(working[index]!);
    if (!truncation) break; // largest remaining entry is already at preview size
    truncations.push(truncation);
  }

  return {
    results: working,
    truncations,
    overflow: toolResultsByteLength(working) > maxBytes,
  };
}
