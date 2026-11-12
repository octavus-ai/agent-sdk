/**
 * Socket-drop signatures seen when a connection to a peer is reset or closed
 * mid-request. Matched against both `.message` and `.code`, case-insensitively.
 * `undici`'s `fetch` wraps the real reason under `.cause` and surfaces a bare
 * `TypeError: terminated` at the top level, so `terminated` and the `UND_ERR_*`
 * codes belong here alongside the raw Node socket codes.
 */
const TRANSIENT_TRANSPORT_PATTERNS = [
  'terminated',
  'fetch failed',
  'socket hang up',
  'other side closed',
  'connection closed',
  'econnreset',
  'econnrefused',
  'epipe',
  'etimedout',
  'enotfound',
  'eai_again',
  'und_err_socket',
  'und_err_connect_timeout',
  'und_err_headers_timeout',
  'und_err_body_timeout',
];

/**
 * Whether an error is a transient network/transport failure - a socket to a
 * peer (the platform, a provider, an MCP server) that dropped or was reset
 * mid-request. These recover on their own, so a caller should retry / re-open
 * the connection rather than surface them as a hard failure.
 *
 * Walks the `.cause` chain because `undici` nests the real reason under
 * `cause`: a mid-stream reset arrives as `TypeError: terminated` whose
 * top-level `.message` is only `terminated`, with the useful `read ECONNRESET`
 * / `code: 'ECONNRESET'` one level down. Matching `.message` alone (no walk)
 * misses it and misclassifies the drop as an opaque platform fault.
 */
export function isTransientTransportError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== 'object' || current === null) break;
    const obj = current as { message?: unknown; code?: unknown; cause?: unknown };
    const haystack = `${typeof obj.message === 'string' ? obj.message : ''} ${
      typeof obj.code === 'string' ? obj.code : ''
    }`.toLowerCase();
    if (TRANSIENT_TRANSPORT_PATTERNS.some((pattern) => haystack.includes(pattern))) {
      return true;
    }
    current = obj.cause;
  }
  return false;
}

/**
 * The platform's error code for a `continue` that names an execution the
 * session no longer holds in a resumable state - it finished, expired, or was
 * lost before its first save. Returned with HTTP 409. The caller re-sends the
 * original trigger to start the turn over.
 */
export const EXECUTION_NOT_RESUMABLE_CODE = 'EXECUTION_NOT_RESUMABLE';

/**
 * The platform's error code for a `continue` that submits a result for a tool
 * call the execution did not request. Returned with HTTP 400.
 */
export const UNKNOWN_TOOL_CALL_CODE = 'UNKNOWN_TOOL_CALL';

/**
 * The platform's error code for an operation that needs a session's live state
 * (a new execution, an upload) on a session whose state has expired or been
 * cleared. Returned with HTTP 409: the session exists and reads `expired`;
 * restore it from the messages you stored, or start a new one.
 */
export const SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';

/**
 * The platform's error code for a `file` input whose reference it cannot
 * accept: a platform file that does not exist, belongs to another project, is
 * outside the credential's scope, was reserved but never uploaded, or exceeds
 * the size limit, or a URL that is neither platform storage nor `https:`.
 * Returned with HTTP 400, naming the input and the file id.
 */
export const INVALID_FILE_REFERENCE_CODE = 'INVALID_FILE_REFERENCE';
