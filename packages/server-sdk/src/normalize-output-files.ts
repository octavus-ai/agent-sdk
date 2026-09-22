import {
  sniffImageMediaType,
  NOT_A_VALID_IMAGE_NOTE,
  type ToolResult,
  type FileReference,
} from '@octavus/core';
import type { FilesApi, FileUploadRequest } from '@/files.js';

/**
 * Wire shape produced by tool handlers that need to surface output files
 * (typically device-side skill execution). The normalizer below uploads the
 * `contentBase64` payloads via presigned URLs, replaces the embedded content
 * with `{name, mediaType, url, size, path?}` summaries in the tool result,
 * and attaches `FileReference` entries on `toolResult.files` so the platform
 * emits `file-available` events on the next continue.
 *
 * `path` (optional) is the absolute path of the file on the device
 * filesystem. When present, the platform uses it to dedup explicit
 * `octavus_file_upload` calls against auto-collected outputs and exposes
 * it to the LLM so subsequent skills in the same turn can chain by path.
 */
interface ToolResultOutputFile {
  name: string;
  path?: string;
  mediaType: string;
  size: number;
  contentBase64: string;
}

interface ToolResultOutputFileSummary {
  name: string;
  path?: string;
  mediaType: string;
  size: number;
  url: string;
  /**
   * Present when the file was uploaded but deliberately not attached for the
   * model to see - an output labeled an image whose bytes are not a valid
   * image (see `NOT_A_VALID_IMAGE_NOTE`).
   */
  error?: string;
}

interface ToolResultOutputFileError {
  name: string;
  path?: string;
  mediaType: string;
  size: number;
  error: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolResultOutputFile(value: unknown): value is ToolResultOutputFile {
  if (!isObject(value)) return false;
  return (
    typeof value.name === 'string' &&
    (value.path === undefined || typeof value.path === 'string') &&
    typeof value.mediaType === 'string' &&
    typeof value.size === 'number' &&
    typeof value.contentBase64 === 'string'
  );
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/**
 * Upload `outputFiles` payloads embedded in tool results via presigned URLs
 * and replace them with download-only summaries.
 *
 * Mirrors the `normalizeToolResultMedia` flow: runs server-side at the
 * `onToolResults` callback so file contents never travel over the
 * tool-result wire (which would inflate continue payloads and bypass S3).
 *
 * An output labeled an image (`image/*`, typically guessed from its extension)
 * is attached for the model to see only if its bytes are a recognizable image;
 * a valid image with a wrong extension is corrected to its true type. A
 * non-image saved with an image name (an error page saved as `.jpg`) is still
 * uploaded and its link returned, but never attached as an image, and its
 * summary carries `NOT_A_VALID_IMAGE_NOTE` so the agent learns why the model
 * cannot see it instead of the whole request being rejected downstream.
 *
 * On failure (network error, presigned URL rejection), `contentBase64` is
 * stripped to prevent the raw data from bloating the LLM context. The entry
 * is replaced with a compact `{name, mediaType, size, error}` summary so
 * the agent sees the failure without the payload.
 */
export async function normalizeToolResultOutputFiles(
  toolResults: ToolResult[],
  filesApi: FilesApi,
  sessionId: string,
): Promise<void> {
  for (const toolResult of toolResults) {
    if (toolResult.outputVariable) continue;
    const result = toolResult.result;
    if (!isObject(result)) continue;
    const rawOutputFiles = result.outputFiles;
    if (!Array.isArray(rawOutputFiles) || rawOutputFiles.length === 0) continue;

    const outputs = rawOutputFiles.filter(isToolResultOutputFile);
    if (outputs.length === 0) continue;

    const buffers: ArrayBuffer[] = [];
    const uploadRequests: FileUploadRequest[] = [];
    // Whether each output is labeled an image but is not one (never attached).
    const invalidImage: boolean[] = [];
    for (const output of outputs) {
      const buffer = base64ToArrayBuffer(output.contentBase64);
      const declaredImage = output.mediaType.startsWith('image/');
      const sniffed = declaredImage ? sniffImageMediaType(new Uint8Array(buffer)) : undefined;
      buffers.push(buffer);
      invalidImage.push(declaredImage && sniffed === undefined);
      uploadRequests.push({
        filename: output.name,
        mediaType: sniffed ?? output.mediaType,
        size: output.size,
      });
    }

    let uploadInfos: { id: string; uploadUrl: string; downloadUrl: string }[];
    try {
      const response = await filesApi.getUploadUrls(sessionId, uploadRequests);
      uploadInfos = response.files;
    } catch {
      result.outputFiles = outputs.map(
        (o): ToolResultOutputFileError => ({
          name: o.name,
          ...(o.path !== undefined ? { path: o.path } : {}),
          mediaType: o.mediaType,
          size: o.size,
          error: 'Upload failed',
        }),
      );
      continue;
    }

    const uploadResults = await Promise.allSettled(
      uploadInfos.map((info, i) =>
        fetch(info.uploadUrl, {
          method: 'PUT',
          body: buffers[i]!,
          headers: { 'Content-Type': uploadRequests[i]!.mediaType },
        }),
      ),
    );

    const files: FileReference[] = toolResult.files ? [...toolResult.files] : [];
    const summaries: (ToolResultOutputFileSummary | ToolResultOutputFileError)[] = [];

    for (let i = 0; i < outputs.length; i++) {
      const upload = uploadResults[i]!;
      const info = uploadInfos[i]!;
      const request = uploadRequests[i]!;
      const output = outputs[i]!;

      if (upload.status === 'fulfilled' && upload.value.ok) {
        // An output labeled an image whose bytes are not one is never added to
        // `files` - that is what would attach it as a vision block.
        if (!invalidImage[i]) {
          files.push({
            id: info.id,
            mediaType: request.mediaType,
            url: info.downloadUrl,
            filename: request.filename,
            size: request.size,
          });
        }
        summaries.push({
          name: request.filename,
          ...(output.path !== undefined ? { path: output.path } : {}),
          mediaType: request.mediaType,
          size: request.size,
          url: info.downloadUrl,
          ...(invalidImage[i] ? { error: NOT_A_VALID_IMAGE_NOTE } : {}),
        });
      } else {
        summaries.push({
          name: request.filename,
          ...(output.path !== undefined ? { path: output.path } : {}),
          mediaType: request.mediaType,
          size: request.size,
          error: 'Upload failed',
        });
      }
    }

    toolResult.files = files;
    result.outputFiles = summaries;
  }
}
