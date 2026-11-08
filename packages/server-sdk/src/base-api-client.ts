import type { ZodType } from 'zod';
import { throwApiError } from '@/api-error.js';

export interface ApiClientConfig {
  baseUrl: string;
  /**
   * Resolve the request headers. May be async so the credential can be sourced
   * from a token provider (e.g. a freshly signed federated token) per request.
   */
  getHeaders: () => Record<string, string> | Promise<Record<string, string>>;
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

/** A parsed response together with its HTTP status, for the calls whose status carries meaning. */
export interface ApiResponse<T> {
  status: number;
  data: T;
}

/** Base class for API clients with shared HTTP utilities */
export abstract class BaseApiClient {
  protected readonly config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  protected async httpGet<T>(
    path: string,
    schema: ZodType<T>,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    const response = await fetch(this.url(path, query), {
      method: 'GET',
      headers: await this.config.getHeaders(),
    });
    return await this.readJson(response, schema);
  }

  protected async httpPost<T>(
    path: string,
    body: unknown,
    schema: ZodType<T>,
    options: { headers?: Record<string, string> } = {},
  ): Promise<T> {
    const response = await fetch(this.url(path), {
      method: 'POST',
      headers: { ...(await this.config.getHeaders()), ...options.headers },
      body: JSON.stringify(body),
    });
    return await this.readJson(response, schema);
  }

  /**
   * POST a multipart form. The JSON content type the shared headers carry is
   * dropped so the runtime sets the multipart boundary itself.
   */
  protected async httpPostForm<T>(
    path: string,
    form: FormData,
    schema: ZodType<T>,
  ): Promise<ApiResponse<T>> {
    const { 'Content-Type': _contentType, ...headers } = await this.config.getHeaders();
    const response = await fetch(this.url(path), { method: 'POST', headers, body: form });
    return { status: response.status, data: await this.readJson(response, schema) };
  }

  protected async httpPatch<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    const response = await fetch(this.url(path), {
      method: 'PATCH',
      headers: await this.config.getHeaders(),
      body: JSON.stringify(body),
    });
    return await this.readJson(response, schema);
  }

  protected async httpPut<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    const response = await fetch(this.url(path), {
      method: 'PUT',
      headers: await this.config.getHeaders(),
      body: JSON.stringify(body),
    });
    return await this.readJson(response, schema);
  }

  protected async httpDelete<T>(path: string, schema: ZodType<T>): Promise<T> {
    const response = await fetch(this.url(path), {
      method: 'DELETE',
      headers: await this.config.getHeaders(),
    });
    return await this.readJson(response, schema);
  }

  private url(path: string, query?: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, value);
    }
    const search = params.toString();
    return `${this.config.baseUrl}${path}${search ? `?${search}` : ''}`;
  }

  private async readJson<T>(response: Response, schema: ZodType<T>): Promise<T> {
    if (!response.ok) {
      await throwApiError(response, 'Request failed');
    }
    const data: unknown = await response.json();
    return schema.parse(data);
  }
}
