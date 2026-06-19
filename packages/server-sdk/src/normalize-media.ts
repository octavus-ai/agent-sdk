import {
  generateId,
  findInlineMediaParts,
  isInlineMediaPart,
  inlineMediaType,
  extensionForMediaType,
  type InlineMediaKind,
  type ToolResult,
  type FileReference,
} from '@octavus/core';
import type { FilesApi, FileUploadInfo, FileUploadRequest } from '@/files.js';

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
 * Extract inline media blobs (images, audio, binary) from MCP tool results,
 * upload them to S3 via presigned URLs, and replace the base64 `data` with a
 * compact URL reference.
 *
 * Images are additionally attached as `FileReference`s so the model receives
 * them as vision; audio and other binaries become a URL + metadata only - the
 * agent gets a link, never the raw bytes.
 *
 * Runs at the server-sdk streaming layer so payloads are uploaded before tool
 * results travel over the network (WebSocket, HTTP continuation). Handles both
 * shapes MCP tools produce: a bare array of content parts and the
 * `{ content: [...] }` wrapper the filesystem server's `read_media_file`
 * returns. On failure (presigned URL acquisition error or PUT rejection) the
 * inline data is stripped and replaced with a compact error summary so the
 * agent sees the failure without the payload bloating the LLM context.
 */
export async function normalizeToolResultMedia(
  toolResults: ToolResult[],
  filesApi: FilesApi,
  sessionId: string,
): Promise<void> {
  for (const toolResult of toolResults) {
    if (toolResult.outputVariable) continue;

    const location = findInlineMediaParts(toolResult.result);
    if (!location) continue;

    const files: FileReference[] = toolResult.files ? [...toolResult.files] : [];

    // Collect the media parts that need uploading, preserving part order so the
    // upload results can be mapped back to their original positions.
    const partIndices: number[] = [];
    const kinds: InlineMediaKind[] = [];
    const buffers: ArrayBuffer[] = [];
    const requests: FileUploadRequest[] = [];

    location.parts.forEach((part, index) => {
      if (!isInlineMediaPart(part)) return;
      const buffer = base64ToArrayBuffer(part.data);
      const mediaType = inlineMediaType(part);
      partIndices.push(index);
      kinds.push(part.type);
      buffers.push(buffer);
      requests.push({
        filename: `${part.type}-${generateId()}.${extensionForMediaType(mediaType)}`,
        mediaType,
        size: buffer.byteLength,
      });
    });

    if (requests.length === 0) continue;

    let uploadInfos: FileUploadInfo[] | null = null;
    try {
      const response = await filesApi.getUploadUrls(sessionId, requests);
      uploadInfos = response.files;
    } catch {
      uploadInfos = null;
    }

    const uploadResults =
      uploadInfos === null
        ? null
        : await Promise.allSettled(
            uploadInfos.map((info, i) =>
              fetch(info.uploadUrl, {
                method: 'PUT',
                body: buffers[i]!,
                headers: { 'Content-Type': requests[i]!.mediaType },
              }),
            ),
          );

    // Map original part index -> replacement summary part.
    const summaryByIndex = new Map<number, unknown>();
    partIndices.forEach((partIndex, i) => {
      const kind = kinds[i]!;
      const mediaType = requests[i]!.mediaType;
      const filename = requests[i]!.filename;
      const size = buffers[i]!.byteLength;
      const info = uploadInfos?.[i];
      const uploaded = uploadResults?.[i];
      const ok = uploaded?.status === 'fulfilled' && uploaded.value.ok && info !== undefined;

      if (ok) {
        if (kind === 'image') {
          files.push({ id: info.id, mediaType, url: info.downloadUrl, filename, size });
        }
        summaryByIndex.set(partIndex, { type: kind, mediaType, size, url: info.downloadUrl });
      } else {
        summaryByIndex.set(partIndex, { type: kind, mediaType, size, error: 'Upload failed' });
      }
    });

    const replacements = location.parts.map((part, index) =>
      summaryByIndex.has(index) ? summaryByIndex.get(index) : part,
    );

    toolResult.files = files;
    toolResult.result = location.rebuild(replacements);
  }
}
