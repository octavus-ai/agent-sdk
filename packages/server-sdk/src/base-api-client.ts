import type { ZodType } from 'zod';
import { throwApiError } from '@/api-error.js';

export { ApiError } from '@/api-error.js';

export interface ApiClientConfig {
  baseUrl: string;
  getHeaders: () => Record<string, string>;
  /** Maximum retries for transient network failures during streaming execution. */
  maxRetries?: number;
  /**
   * Idle timeout (ms) for the streaming read loop. The platform emits an SSE
   * heartbeat every 15s, so a live connection is never silent for longer than
   * that; if no bytes arrive within this window the connection is treated as
   * dead and the stream ends like a transport drop so the caller can retry.
   * Set to 0 to disable. Defaults to 60s.
   */
  streamIdleTimeoutMs?: number;
  /**
   * Maximum size (bytes) of a continuation request body. Oversized tool results
   * are reduced to a preview before sending so a large payload can't be rejected
   * with a 413 that fails the run. Defaults to 4 MiB, sized under the platform's
   * request-body limit.
   */
  maxContinuationBytes?: number;
}

/** Base class for API clients with shared HTTP utilities */
export abstract class BaseApiClient {
  protected readonly config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  protected async httpGet<T>(path: string, schema: ZodType<T>): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'GET',
      headers: this.config.getHeaders(),
    });

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data: unknown = await response.json();
    return schema.parse(data);
  }

  protected async httpPost<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: this.config.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data: unknown = await response.json();
    return schema.parse(data);
  }

  protected async httpPatch<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.config.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data: unknown = await response.json();
    return schema.parse(data);
  }

  protected async httpDelete<T>(path: string, schema: ZodType<T>): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.config.getHeaders(),
    });

    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }

    const data: unknown = await response.json();
    return schema.parse(data);
  }
}
