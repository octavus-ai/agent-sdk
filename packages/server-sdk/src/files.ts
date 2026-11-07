import { z } from 'zod';
import { BaseApiClient } from '@/base-api-client.js';

// =============================================================================
// Schemas
// =============================================================================

/**
 * Schema for a single file upload request
 */
export const fileUploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mediaType: z.string().min(1),
  size: z.number().int().positive(),
});

/**
 * Schema for a single file upload response
 */
export const fileUploadInfoSchema = z.object({
  /** File ID to reference in messages */
  id: z.string(),
  /** Presigned PUT URL for uploading to S3 */
  uploadUrl: z.url(),
  /** Presigned GET URL for downloading after upload */
  downloadUrl: z.url(),
});

/**
 * Schema for the upload URLs response
 */
export const uploadUrlsResponseSchema = z.object({
  files: z.array(fileUploadInfoSchema),
});

// =============================================================================
// Types
// =============================================================================

export type FileUploadRequest = z.infer<typeof fileUploadRequestSchema>;
export type FileUploadInfo = z.infer<typeof fileUploadInfoSchema>;
export type UploadUrlsResponse = z.infer<typeof uploadUrlsResponseSchema>;

// =============================================================================
// API
// =============================================================================

/**
 * API for file operations.
 *
 * Provides methods to generate presigned URLs for file uploads.
 * Files are uploaded directly to S3, not through the platform.
 *
 * @example
 * ```typescript
 * // Get upload URLs
 * const { files } = await client.files.getUploadUrls(sessionId, [
 *   { filename: 'image.png', mediaType: 'image/png', size: 12345 }
 * ]);
 *
 * // Upload directly to S3
 * await fetch(files[0].uploadUrl, {
 *   method: 'PUT',
 *   body: imageFile,
 *   headers: { 'Content-Type': 'image/png' }
 * });
 *
 * // Use downloadUrl as FileReference in trigger input
 * ```
 */
export class FilesApi extends BaseApiClient {
  /**
   * Get presigned URLs for uploading files to a session.
   *
   * Returns upload URLs (PUT) and download URLs (GET) for each file.
   * Upload URLs expire in 15 minutes, download URLs match session TTL (24 hours).
   *
   * @param sessionId - The session ID to associate files with
   * @param files - Array of file metadata (filename, mediaType, size)
   * @returns Upload info with presigned URLs for each file
   *
   * @throws OctavusError if session doesn't exist or validation fails
   *
   * @example
   * ```typescript
   * const { files } = await client.files.getUploadUrls(sessionId, [
   *   { filename: 'photo.jpg', mediaType: 'image/jpeg', size: 102400 },
   *   { filename: 'doc.pdf', mediaType: 'application/pdf', size: 204800 },
   * ]);
   *
   * // files[0].id - Use in FileReference
   * // files[0].uploadUrl - PUT to this URL
   * // files[0].downloadUrl - Use as FileReference.url
   * ```
   */
  async getUploadUrls(sessionId: string, files: FileUploadRequest[]): Promise<UploadUrlsResponse> {
    return await this.httpPost(
      '/api/files/upload-urls',
      { sessionId, files },
      uploadUrlsResponseSchema,
    );
  }
}
