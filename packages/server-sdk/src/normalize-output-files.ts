import type { ToolResult, FileReference } from '@octavus/core';
import type { FilesApi, FileUploadRequest } from '@/files.js';

/**
 * Wire shape produced by tool handlers that need to surface output files
 * (typically device-side skill execution). The normalizer below uploads the
 * `contentBase64` payloads via presigned URLs, replaces the embedded content
 * with `{name, mediaType, url, size}` summaries in the tool result, and
 * attaches `FileReference` entries on `toolResult.files` so the platform
 * emits `file-available` events on the next continue.
 */
interface ToolResultOutputFile {
  name: string;
  mediaType: string;
  size: number;
  contentBase64: string;
}

interface ToolResultOutputFileSummary {
  name: string;
  mediaType: string;
  size: number;
  url: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolResultOutputFile(value: unknown): value is ToolResultOutputFile {
  if (!isObject(value)) return false;
  return (
    typeof value.name === 'string' &&
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
 * Mirrors the `normalizeToolResultImages` flow: runs server-side at the
 * `onToolResults` callback so file contents never travel over the
 * tool-result wire (which would inflate continue payloads and bypass S3).
 *
 * Per-result failures (network error, presigned URL acquisition error)
 * leave the offending entry untouched - the tool result still flows to the
 * model with the original payload so the agent can decide whether to retry.
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
    for (const output of outputs) {
      const buffer = base64ToArrayBuffer(output.contentBase64);
      buffers.push(buffer);
      uploadRequests.push({
        filename: output.name,
        mediaType: output.mediaType,
        size: output.size,
      });
    }

    let uploadInfos: { id: string; uploadUrl: string; downloadUrl: string }[];
    try {
      const response = await filesApi.getUploadUrls(sessionId, uploadRequests);
      uploadInfos = response.files;
    } catch {
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
    const summaries: (ToolResultOutputFile | ToolResultOutputFileSummary)[] = [];

    for (let i = 0; i < outputs.length; i++) {
      const upload = uploadResults[i]!;
      const info = uploadInfos[i]!;
      const request = uploadRequests[i]!;
      const original = outputs[i]!;

      if (upload.status === 'fulfilled' && upload.value.ok) {
        files.push({
          id: info.id,
          mediaType: request.mediaType,
          url: info.downloadUrl,
          filename: request.filename,
          size: request.size,
        });
        summaries.push({
          name: request.filename,
          mediaType: request.mediaType,
          size: request.size,
          url: info.downloadUrl,
        });
      } else {
        // Keep the original entry so the agent can see something failed and
        // retry the script. The bloat is bounded by the per-bundle entry cap.
        summaries.push(original);
      }
    }

    toolResult.files = files;
    result.outputFiles = summaries;
  }
}
