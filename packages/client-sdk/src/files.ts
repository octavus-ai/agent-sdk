import type { FileReference } from '@octavus/core';

/**
 * Response from the upload URLs endpoint
 */
export interface UploadUrlsResponse {
  files: {
    id: string;
    uploadUrl: string;
    downloadUrl: string;
  }[];
}

/**
 * Options for uploading files
 */
export interface UploadFilesOptions {
  /**
   * Function to request upload URLs from the platform.
   * Consumer apps must implement this to authenticate with the platform.
   *
   * @param files - Array of file metadata to request URLs for
   * @returns Response with presigned upload and download URLs
   *
   * @example
   * ```typescript
   * requestUploadUrls: async (files) => {
   *   const response = await fetch('/api/upload-urls', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify({ sessionId, files }),
   *   });
   *   return response.json();
   * }
   * ```
   */
  requestUploadUrls: (
    files: { filename: string; mediaType: string; size: number }[],
  ) => Promise<UploadUrlsResponse>;

  /**
   * Callback for upload progress (0-100 per file).
   * Called multiple times during upload with real-time progress.
   *
   * @param fileIndex - Index of the file being uploaded
   * @param progress - Progress percentage (0-100)
   */
  onProgress?: (fileIndex: number, progress: number) => void;

  /** Upload timeout per file in milliseconds. Default: 60000 (60s). Set to 0 to disable. */
  timeoutMs?: number;

  /** Max retry attempts per file after initial failure. Default: 2. Set to 0 to disable retries. */
  maxRetries?: number;

  /** Delay between retries in milliseconds. Default: 1000 (1s). */
  retryDelayMs?: number;
}

const UPLOAD_DEFAULTS = {
  timeoutMs: 60_000,
  maxRetries: 2,
  retryDelayMs: 1_000,
} as const;

class UploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Upload a single file to S3 with progress tracking and timeout.
 * Uses XMLHttpRequest for upload progress events (fetch doesn't support this).
 */
function uploadFileWithProgress(
  url: string,
  file: File,
  onProgress?: (progress: number) => void,
  timeoutMs?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (timeoutMs !== undefined && timeoutMs > 0) {
      xhr.timeout = timeoutMs;
      xhr.addEventListener('timeout', () => {
        reject(new UploadError(`Upload timed out after ${timeoutMs}ms`, true));
      });
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress?.(progress);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const detail = xhr.responseText ? `: ${xhr.responseText}` : '';
        const retryable = xhr.status >= 500 || xhr.status === 429;
        reject(
          new UploadError(
            `Upload failed with status ${xhr.status}${detail}`,
            retryable,
            xhr.status,
          ),
        );
      }
    });

    xhr.addEventListener('error', () => {
      reject(new UploadError('Upload failed: network error', true));
    });

    xhr.addEventListener('abort', () => {
      reject(new UploadError('Upload aborted', false));
    });

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Upload a single file with automatic retries on transient failures.
 * Only the S3 PUT is retried - the presigned URL stays valid for 15 minutes.
 */
async function uploadFileWithRetry(
  url: string,
  file: File,
  onProgress: ((progress: number) => void) | undefined,
  timeoutMs: number,
  maxRetries: number,
  retryDelayMs: number,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await uploadFileWithProgress(url, file, onProgress, timeoutMs);
      return;
    } catch (err) {
      lastError = err;

      const isRetryable = err instanceof UploadError && err.retryable;
      if (!isRetryable || attempt >= maxRetries) {
        break;
      }

      onProgress?.(0);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

/**
 * Upload files to the Octavus platform.
 *
 * This function:
 * 1. Requests presigned upload URLs from the platform
 * 2. Uploads each file directly to S3 with progress tracking
 * 3. Returns file references that can be used in trigger input
 *
 * Uploads include automatic timeout (default 60s) and retry (default 2 retries)
 * for transient failures like network errors or server issues.
 *
 * @param files - Files to upload (from file input or drag/drop)
 * @param options - Upload configuration
 * @returns Array of file references with download URLs
 *
 * @example
 * ```typescript
 * const fileRefs = await uploadFiles(fileInputRef.current.files, {
 *   requestUploadUrls: async (files) => {
 *     const response = await fetch('/api/upload-urls', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ sessionId, files }),
 *     });
 *     return response.json();
 *   },
 *   onProgress: (fileIndex, progress) => {
 *     console.log(`File ${fileIndex}: ${progress}%`);
 *   },
 * });
 * ```
 */
export async function uploadFiles(
  files: FileList | File[],
  options: UploadFilesOptions,
): Promise<FileReference[]> {
  const fileArray = Array.from(files);

  if (fileArray.length === 0) {
    return [];
  }

  const timeoutMs = options.timeoutMs ?? UPLOAD_DEFAULTS.timeoutMs;
  const maxRetries = options.maxRetries ?? UPLOAD_DEFAULTS.maxRetries;
  const retryDelayMs = options.retryDelayMs ?? UPLOAD_DEFAULTS.retryDelayMs;

  const { files: uploadInfos } = await options.requestUploadUrls(
    fileArray.map((f) => ({
      filename: f.name,
      mediaType: f.type || 'application/octet-stream',
      size: f.size,
    })),
  );

  const references: FileReference[] = [];

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i]!;
    const uploadInfo = uploadInfos[i]!;

    await uploadFileWithRetry(
      uploadInfo.uploadUrl,
      file,
      options.onProgress ? (progress) => options.onProgress!(i, progress) : undefined,
      timeoutMs,
      maxRetries,
      retryDelayMs,
    );

    references.push({
      id: uploadInfo.id,
      mediaType: file.type || 'application/octet-stream',
      url: uploadInfo.downloadUrl,
      filename: file.name,
      size: file.size,
    });
  }

  return references;
}
