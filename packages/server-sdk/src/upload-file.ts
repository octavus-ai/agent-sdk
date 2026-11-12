import { OctavusError, sniffImageDimensions, type FileReference } from '@octavus/core';
import type { FileUploadInfo, FileUploadRequest } from '@/files.js';

/** The bytes to upload: a `Blob` (a `File` included), a `Uint8Array` (a `Buffer` included), or an `ArrayBuffer`. */
export type FileUploadData = Blob | Uint8Array | ArrayBuffer;

/** What the platform records about an uploaded file; the size is read from the data. */
export interface FileUploadMeta {
  filename: string;
  /** The IANA media type (`image/png`, `application/pdf`, ...). */
  mediaType: string;
}

/**
 * Upload one file in one call: reserve a slot through `reserve`, PUT the bytes
 * to storage, and build the `FileReference` to pass wherever a protocol takes
 * a `file`. An image's pixel dimensions are read from its header, so an agent
 * with an image cap knows whether the image fits without fetching it.
 */
export async function uploadFile(
  reserve: (files: FileUploadRequest[]) => Promise<{ files: FileUploadInfo[] }>,
  data: FileUploadData,
  meta: FileUploadMeta,
): Promise<FileReference> {
  const bytes = await toBytes(data);
  const size = bytes.byteLength;

  const { files } = await reserve([{ filename: meta.filename, mediaType: meta.mediaType, size }]);
  const slot = files[0];
  if (!slot) {
    throw OctavusError.internal('The platform returned no upload slot for the file');
  }

  const response = await fetch(slot.uploadUrl, {
    method: 'PUT',
    body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: meta.mediaType }),
    headers: { 'Content-Type': meta.mediaType },
  });
  if (!response.ok) {
    await response.body?.cancel();
    const reason = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    throw new OctavusError({
      errorType: 'internal_error',
      message: `Uploading "${meta.filename}" failed: ${reason}`,
      source: 'platform',
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    });
  }

  return {
    id: slot.id,
    mediaType: meta.mediaType,
    url: slot.downloadUrl,
    filename: meta.filename,
    size,
    ...(meta.mediaType.startsWith('image/') ? sniffImageDimensions(bytes) : {}),
  };
}

async function toBytes(data: FileUploadData): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}
