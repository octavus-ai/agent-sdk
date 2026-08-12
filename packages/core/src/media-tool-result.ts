/**
 * Inline media handling for MCP tool results.
 *
 * MCP tools can embed binary payloads (images, audio, arbitrary blobs) directly
 * in a tool result as base64. Letting that raw `data` reach the model is
 * catastrophic - a single screenshot is megabytes of base64 that floods the
 * context window. The runtime uploads these payloads and swaps the inline data
 * for a URL reference. This module locates such parts regardless of how the
 * tool result is shaped:
 *
 * - a bare array of content parts (e.g. computer-use screenshots), or
 * - an MCP `{ content: [...] }` wrapper (e.g. the filesystem server's
 *   `read_media_file`, which declares an `outputSchema` and so returns its
 *   payload nested under `structuredContent.content`).
 */

/** Inline media kinds an MCP tool can return as base64. */
export type InlineMediaKind = 'image' | 'audio' | 'blob';

export interface InlineMediaPart {
  type: InlineMediaKind;
  /** Base64-encoded payload. */
  data: string;
  /** IANA media type, when the tool provides one. */
  mimeType?: string;
}

const INLINE_MEDIA_KINDS = new Set<string>(['image', 'audio', 'blob']);

export function isInlineMediaPart(part: unknown): part is InlineMediaPart {
  if (typeof part !== 'object' || part === null) return false;
  const record = part as Record<string, unknown>;
  return (
    typeof record.type === 'string' &&
    INLINE_MEDIA_KINDS.has(record.type) &&
    typeof record.data === 'string'
  );
}

/**
 * Effective IANA media type for an inline media part. When the tool omits the
 * media type, an image falls back to `image/png` so it still reaches the model
 * as vision (delivery keys off an `image/*` type); audio and other blobs fall
 * back to a generic binary type.
 */
export function inlineMediaType(part: InlineMediaPart): string {
  if (part.mimeType) return part.mimeType;
  return part.type === 'image' ? 'image/png' : 'application/octet-stream';
}

/**
 * Detect the true image media type of a payload from its leading "magic" bytes,
 * limited to the provider-safe vision set (PNG, JPEG, GIF, WebP). Returns the
 * matching media type, or `undefined` for anything else - non-image bytes (an
 * HTML error page, a PDF, plain text) or an image format vision providers reject
 * (BMP, TIFF, HEIC, SVG).
 *
 * Content-based, so it catches a payload whose declared type or extension lies
 * about its contents. That is the failure mode where the filesystem server's
 * `read_media_file` labels a non-image `image/png` by extension: the invalid
 * "image" then bricks the provider request with a non-retryable "file format is
 * invalid or unsupported" 400. Dependency-free (no image decoder), so it is safe
 * to run everywhere inline media is normalized, including browser/runtime-light
 * environments.
 */
export function sniffImageMediaType(bytes: Uint8Array): string | undefined {
  const b = bytes;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" / "GIF89a"
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * Note attached to a tool-result media part that was declared an image but whose
 * bytes are not a decodable/supported image, so it was delivered as a download
 * link instead of a vision block. Shared by every media-normalization path so the
 * agent gets the same actionable message wherever the result was produced.
 */
export const NOT_A_VALID_IMAGE_NOTE =
  'This file was reported as an image but its contents are not a valid or ' +
  'supported image, so it was provided as a download link only and not shown to ' +
  'the model as an image. The download likely returned non-image content (for ' +
  'example an HTML error or sign-in page) or a corrupt/unsupported file - verify ' +
  'the source and re-fetch if you need the image.';

/**
 * The content-parts array of a tool result plus a way to rebuild the result
 * from replacement parts, preserving the result's original shape.
 */
export interface InlineMediaLocation {
  parts: unknown[];
  rebuild: (replacements: unknown[]) => unknown;
}

/**
 * Locate inline media parts in a tool result. Handles both the bare-array shape
 * and the `{ content: [...] }` wrapper. Returns `null` when the result holds no
 * inline media so callers can skip it untouched.
 */
export function findInlineMediaParts(result: unknown): InlineMediaLocation | null {
  if (Array.isArray(result)) {
    return result.some(isInlineMediaPart)
      ? { parts: result, rebuild: (replacements) => replacements }
      : null;
  }

  if (typeof result === 'object' && result !== null) {
    const { content } = result as { content?: unknown };
    if (Array.isArray(content) && content.some(isInlineMediaPart)) {
      const base = result as Record<string, unknown>;
      return {
        parts: content,
        rebuild: (replacements) => ({ ...base, content: replacements }),
      };
    }
  }

  return null;
}

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
};

/**
 * File extension for an uploaded media payload, derived from its media type.
 * Falls back to `bin` for unknown or generic (`application/octet-stream`) types.
 */
export function extensionForMediaType(mediaType: string): string {
  return MEDIA_TYPE_EXTENSIONS[mediaType] ?? 'bin';
}

/** Approximate decoded byte length of a base64 string (good enough for metadata). */
export function base64ByteLength(data: string): number {
  return Math.floor((data.length * 3) / 4);
}

/**
 * Final guard: strip inline base64 `data` from any media part that was not
 * uploaded (has no `url`), replacing it with compact metadata. Ensures raw
 * bytes can never reach the model even if upload or normalization was skipped
 * or failed upstream. Returns the result unchanged when there is nothing to
 * strip (the common case - normalized results already carry a `url`, not data).
 */
export function stripInlineMediaData(result: unknown): unknown {
  const location = findInlineMediaParts(result);
  if (!location) return result;

  const replacements = location.parts.map((part) => {
    if (!isInlineMediaPart(part)) return part;
    return {
      type: part.type,
      mediaType: inlineMediaType(part),
      size: base64ByteLength(part.data),
      omitted: true,
    };
  });

  return location.rebuild(replacements);
}
