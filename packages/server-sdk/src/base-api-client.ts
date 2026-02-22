import type { ZodType } from 'zod';
import { throwApiError } from '@/api-error.js';

export { ApiError } from '@/api-error.js';

export interface ApiClientConfig {
  baseUrl: string;
  getHeaders: () => Record<string, string>;
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
