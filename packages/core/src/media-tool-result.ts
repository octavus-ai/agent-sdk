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

/** Pixel dimensions of a raster image. */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Read the pixel dimensions of a PNG, JPEG, GIF, or WebP payload from its
 * header, without decoding the image. Returns `undefined` for any other format
 * or for a header too short or malformed to read, and never throws.
 *
 * These are the stored dimensions, before any EXIF orientation is applied, so a
 * longest-side comparison reads the same either way. Dependency-free like
 * `sniffImageMediaType`, and it needs only the leading bytes (the frame header
 * for JPEG, the first few dozen bytes otherwise), so any producer holding an
 * image's bytes can record its size.
 */
export function sniffImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const mediaType = sniffImageMediaType(bytes);
  if (mediaType === 'image/png') return pngDimensions(bytes);
  if (mediaType === 'image/jpeg') return jpegDimensions(bytes);
  if (mediaType === 'image/gif') return gifDimensions(bytes);
  if (mediaType === 'image/webp') return webpDimensions(bytes);
  return undefined;
}

function positiveDimensions(width: number, height: number): ImageDimensions | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function readUint16BE(b: Uint8Array, offset: number): number {
  return (b[offset]! << 8) | b[offset + 1]!;
}

function readUint16LE(b: Uint8Array, offset: number): number {
  return b[offset]! | (b[offset + 1]! << 8);
}

function readUint24LE(b: Uint8Array, offset: number): number {
  return b[offset]! | (b[offset + 1]! << 8) | (b[offset + 2]! << 16);
}

function readUint32BE(b: Uint8Array, offset: number): number {
  return (
    ((b[offset]! << 24) | (b[offset + 1]! << 16) | (b[offset + 2]! << 8) | b[offset + 3]!) >>> 0
  );
}

/** PNG: `IHDR` is always the first chunk, right after the 8-byte signature. */
function pngDimensions(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 24) return undefined;
  const isIhdr = b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52;
  if (!isIhdr) return undefined;
  return positiveDimensions(readUint32BE(b, 16), readUint32BE(b, 20));
}

/** GIF: the logical screen width and height follow the 6-byte signature. */
function gifDimensions(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 10) return undefined;
  return positiveDimensions(readUint16LE(b, 6), readUint16LE(b, 8));
}

/** WebP: the first chunk after the RIFF header is `VP8 ` (lossy), `VP8L` (lossless), or `VP8X` (extended). */
function webpDimensions(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 30) return undefined;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === 'VP8 ') {
    // A 3-byte frame tag and the 9d 01 2a start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
    return positiveDimensions(readUint16LE(b, 26) & 0x3fff, readUint16LE(b, 28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    // A 0x2f signature byte, then width-1 and height-1 packed as consecutive 14-bit fields.
    if (b[20] !== 0x2f) return undefined;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return positiveDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') {
    // Flags and reserved bytes, then the canvas width-1 and height-1 as 24-bit fields.
    return positiveDimensions(readUint24LE(b, 24) + 1, readUint24LE(b, 27) + 1);
  }
  return undefined;
}

/**
 * JPEG: walk the marker segments to the first frame header (SOFn). Any
 * number of `APPn` / table segments (EXIF, ICC, quantization tables) may come
 * first; scan data or the end of the image before a frame header means there
 * is nothing to read.
 */
function jpegDimensions(b: Uint8Array): ImageDimensions | undefined {
  let offset = 2;
  while (offset + 1 < b.length) {
    if (b[offset] !== 0xff) return undefined;
    const marker = b[offset + 1]!;
    // A marker may be preceded by any number of 0xFF fill bytes.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers (TEM, RSTn, SOI) carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // End of image, or the start of scan data, before any frame header.
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (offset + 3 >= b.length) return undefined;
    if (isJpegStartOfFrame(marker)) {
      // Frame header: length (2), sample precision (1), height (2), width (2).
      if (offset + 8 >= b.length) return undefined;
      return positiveDimensions(readUint16BE(b, offset + 7), readUint16BE(b, offset + 5));
    }
    const length = readUint16BE(b, offset + 2);
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

/** SOF0-SOF15, minus DHT (C4), JPG (C8), and DAC (CC), which share the range. */
function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
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
