import { z } from 'zod';
import type { FileReference } from '@octavus/core';
import { BaseApiClient } from '@/base-api-client.js';
import { uploadFile, type FileUploadData, type FileUploadMeta } from '@/upload-file.js';

// =============================================================================
// Schemas
// =============================================================================

/**
 * Schema for a single file upload response
 */
export const fileUploadInfoSchema = z.looseObject({
  id: z.string(),
  uploadUrl: z.url(),
  downloadUrl: z.url(),
});

/**
 * Schema for the upload URLs response
 */
export const uploadUrlsResponseSchema = z.looseObject({
  files: z.array(fileUploadInfoSchema),
});

/** Status is validated leniently (any string) so a status the platform adds later never breaks a read. */
const fileResourceSchema = z.looseObject({
  id: z.string(),
  filename: z.string(),
  mediaType: z.string(),
  size: z.number(),
  status: z.string().transform((s) => s as FileStatus),
  downloadUrl: z.url(),
  createdAt: z.string(),
});

const viewUrlResponseSchema = z.looseObject({
  viewUrl: z.string().nullable(),
});

// =============================================================================
// Types
// =============================================================================

export interface FileUploadRequest {
  filename: string;
  mediaType: string;
  size: number;
}

export interface FileUploadInfo {
  /** File ID to reference in messages */
  id: string;
  /** Presigned PUT URL for uploading to S3 */
  uploadUrl: string;
  /** Presigned GET URL for downloading after upload */
  downloadUrl: string;
}

export interface UploadUrlsResponse {
  files: FileUploadInfo[];
}

/**
 * Whether a file's bytes have landed: `pending` until the upload is confirmed
 * (checked when the file is first read or used), `uploaded` afterwards. New
 * values may be added.
 */
export type FileStatus = 'pending' | 'uploaded';

/** A file of the project, as `files.get` returns it. */
export interface FileResource {
  id: string;
  filename: string;
  mediaType: string;
  /** The declared size until the upload is confirmed; the stored object's size afterwards. */
  size: number;
  status: FileStatus;
  /** A freshly signed download URL. */
  downloadUrl: string;
  /** When the file was reserved (ISO 8601). */
  createdAt: string;
}

// =============================================================================
// API
// =============================================================================

/**
 * API for file operations.
 *
 * A file is a project resource: upload it once, with the key you already
 * have, and pass the reference wherever the protocol takes a `file` - a
 * session input, a trigger, a worker run. Files are uploaded directly to
 * storage, never through the platform.
 *
 * @example
 * ```typescript
 * // One call: reserve, upload, and get the reference to pass on.
 * const image = await client.files.upload(bytes, { filename: 'shot.png', mediaType: 'image/png' });
 * const { output } = await client.workers.generate(graderId, { IMAGE: image });
 *
 * // Two steps, when the bytes are uploaded elsewhere (e.g. by a browser):
 * const { files } = await client.files.createUploads([
 *   { filename: 'image.png', mediaType: 'image/png', size: 12345 },
 * ]);
 * // PUT the bytes to files[0].uploadUrl, then use files[0].downloadUrl as FileReference.url
 * ```
 */
export class FilesApi extends BaseApiClient {
  /**
   * Reserve files in the project and get presigned URLs to upload them with.
   *
   * Returns an upload URL (PUT, valid for 15 minutes) and a download URL (GET)
   * per file. PUT each file to its `uploadUrl` with its `Content-Type`, then
   * reference it as `{ id, mediaType, url: downloadUrl, filename, size }`.
   * No session is needed: the reference is accepted by any session, run, or
   * dispatch of the project.
   *
   * @param files - Array of file metadata (filename, mediaType, size), 1 to 20 files
   * @throws OctavusError if validation fails
   */
  async createUploads(files: FileUploadRequest[]): Promise<UploadUrlsResponse> {
    return await this.httpPost('/api/v1/files', { files }, uploadUrlsResponseSchema);
  }

  /**
   * Upload one file and get the `FileReference` to pass wherever the protocol
   * takes a `file`: reserves a slot, PUTs the bytes, and reads an image's pixel
   * dimensions from its header.
   *
   * @param data - The bytes: a `Blob`, a `Uint8Array` (a `Buffer` included), or an `ArrayBuffer`
   * @param meta - The filename and media type
   * @throws OctavusError if the reservation or the upload fails
   */
  async upload(data: FileUploadData, meta: FileUploadMeta): Promise<FileReference> {
    return await uploadFile((files) => this.createUploads(files), data, meta);
  }

  /**
   * Read a file of the project, with a fresh download URL - the way to refresh
   * a reference whose URL aged out. A file of another project, or one outside
   * the credential's scope, is not found.
   */
  async get(fileId: string): Promise<FileResource> {
    return await this.httpGet(`/api/v1/files/${encodeURIComponent(fileId)}`, fileResourceSchema);
  }

  /**
   * Reserve files for a session you already hold and get presigned URLs to
   * upload them with. The files are the same project files `createUploads`
   * reserves, recorded as uploaded for this session - which is what lets a
   * credential scoped to the session (a browser holding a session-scoped
   * ephemeral token) use them: a scoped credential reaches only the files tied
   * to its session or agent, so a file reserved by your project key with
   * `createUploads` is out of its reach. Use `createUploads` when no session
   * exists yet or the same credential uploads and triggers.
   *
   * @param sessionId - The session the files are uploaded for; must be active
   * @param files - Array of file metadata (filename, mediaType, size), 1 to 20 files
   * @returns Upload info with presigned URLs for each file
   *
   * @throws OctavusError if the session doesn't exist, has expired, or validation fails
   */
  async getUploadUrls(sessionId: string, files: FileUploadRequest[]): Promise<UploadUrlsResponse> {
    return await this.httpPost(
      `/api/v1/sessions/${sessionId}/uploads`,
      { files },
      uploadUrlsResponseSchema,
    );
  }

  /**
   * Get a short-lived view URL for a file the session shows, to render it
   * inline (in a sandboxed frame) without exposing the storage URL. Returns
   * null when the file is not one the session shows; fall back to its download
   * URL then.
   */
  async getViewUrl(sessionId: string, fileUrl: string): Promise<string | null> {
    const { viewUrl } = await this.httpPost(
      `/api/v1/sessions/${sessionId}/files/view-url`,
      { fileUrl },
      viewUrlResponseSchema,
    );
    return viewUrl;
  }
}
