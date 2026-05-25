import { generateId, type ToolResult, type FileReference } from '@octavus/core';
import type { FilesApi, FileUploadRequest } from '@/files.js';

interface ImagePart {
  type: 'image';
  data: string;
  mimeType?: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

function getExtensionFromMediaType(mediaType: string): string {
  return IMAGE_EXTENSIONS[mediaType] ?? 'png';
}

function isImagePart(part: unknown): part is ImagePart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as Record<string, unknown>).type === 'image' &&
    typeof (part as Record<string, unknown>).data === 'string'
  );
}

function hasImageParts(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.some(isImagePart);
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
 * Extract base64 image blobs from tool results, upload them to S3 via
 * presigned URLs, and replace inline data with compact metadata +
 * FileReference entries.
 *
 * Runs at the server-sdk streaming layer so images are uploaded before
 * tool results travel over the network (WebSocket, HTTP continuation).
 *
 * On failure (presigned URL acquisition error or PUT rejection), the
 * base64 `data` is stripped and replaced with a compact
 * `{type:'image', mediaType, size, error}` summary so the agent sees
 * the failure without the payload bloating the LLM context.
 */
export async function normalizeToolResultImages(
  toolResults: ToolResult[],
  filesApi: FilesApi,
  sessionId: string,
): Promise<void> {
  for (const toolResult of toolResults) {
    if (toolResult.outputVariable) continue;
    if (!hasImageParts(toolResult.result)) continue;

    const parts = toolResult.result;
    const files: FileReference[] = toolResult.files ? [...toolResult.files] : [];

    const imageIndices: number[] = [];
    const imageBuffers: ArrayBuffer[] = [];
    const uploadRequests: FileUploadRequest[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!isImagePart(part)) continue;

      const buffer = base64ToArrayBuffer(part.data);
      const mimeType = part.mimeType || 'image/png';

      imageIndices.push(i);
      imageBuffers.push(buffer);
      uploadRequests.push({
        filename: `image-${generateId()}.${getExtensionFromMediaType(mimeType)}`,
        mediaType: mimeType,
        size: buffer.byteLength,
      });
    }

    if (uploadRequests.length === 0) continue;

    let uploadInfos: { id: string; uploadUrl: string; downloadUrl: string }[];
    try {
      const response = await filesApi.getUploadUrls(sessionId, uploadRequests);
      uploadInfos = response.files;
    } catch {
      // Strip base64 data to prevent bloating the LLM context
      const stripped: unknown[] = [];
      let idx = 0;
      for (let i = 0; i < parts.length; i++) {
        if (idx < imageIndices.length && imageIndices[idx] === i) {
          stripped.push({
            type: 'image',
            mediaType: uploadRequests[idx]!.mediaType,
            size: imageBuffers[idx]!.byteLength,
            error: 'Upload failed',
          });
          idx += 1;
        } else {
          stripped.push(parts[i]);
        }
      }
      toolResult.result = stripped;
      continue;
    }

    const uploadResults = await Promise.allSettled(
      uploadInfos.map((info, i) =>
        fetch(info.uploadUrl, {
          method: 'PUT',
          body: imageBuffers[i]!,
          headers: { 'Content-Type': uploadRequests[i]!.mediaType },
        }),
      ),
    );

    const summaryParts: unknown[] = [];
    let imageIdx = 0;

    for (let i = 0; i < parts.length; i++) {
      if (imageIdx < imageIndices.length && imageIndices[imageIdx] === i) {
        const uploadResult = uploadResults[imageIdx]!;
        const info = uploadInfos[imageIdx]!;
        const request = uploadRequests[imageIdx]!;
        const buf = imageBuffers[imageIdx]!;

        if (uploadResult.status === 'fulfilled' && uploadResult.value.ok) {
          files.push({
            id: info.id,
            mediaType: request.mediaType,
            url: info.downloadUrl,
            filename: request.filename,
            size: buf.byteLength,
          });

          summaryParts.push({
            type: 'image',
            mediaType: request.mediaType,
            size: buf.byteLength,
            url: info.downloadUrl,
          });
        } else {
          summaryParts.push({
            type: 'image',
            mediaType: request.mediaType,
            size: buf.byteLength,
            error: 'Upload failed',
          });
        }

        imageIdx += 1;
      } else {
        summaryParts.push(parts[i]);
      }
    }

    toolResult.files = files;
    toolResult.result = summaryParts;
  }
}
