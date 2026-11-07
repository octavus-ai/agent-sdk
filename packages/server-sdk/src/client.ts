import type { ApiClientConfig } from '@/base-api-client.js';
import { AgentsApi } from '@/agents.js';
import { SessionsApi } from '@/sessions.js';
import { FilesApi } from '@/files.js';
import { SkillsApi } from '@/skills.js';
import { WorkersApi } from '@/workers.js';
import { WorkforceApi } from '@/workforce.js';
import { TokensApi } from '@/tokens.js';

/**
 * The API credential. A static string (a long-lived key or a minted ephemeral
 * token), or a provider callback resolved per request - the callback lets a
 * client present a federated workload-identity token that is refreshed as it
 * rotates, without recreating the client.
 */
export type ApiKeyProvider = string | (() => string | Promise<string>);

/** The platform the client talks to when no `baseUrl` is given. */
export const DEFAULT_BASE_URL = 'https://octavus.ai';

export interface OctavusClientConfig {
  /** The platform's URL. Defaults to production (`https://octavus.ai`). */
  baseUrl?: string;
  /**
   * The API credential: a long-lived key, a minted ephemeral token, or a
   * provider callback that returns the current token per request (e.g. a
   * federated workload-identity token that rotates).
   */
  apiKey?: ApiKeyProvider;
  /** Enable model request tracing to capture full payloads sent to providers (default: false) */
  traceModelRequests?: boolean;
  /**
   * Maximum number of retries for transient network failures during streaming
   * execution (tool continuation). Set to 0 to disable retries. Default: 2.
   */
  maxRetries?: number;
  /**
   * Idle timeout (ms) for the streaming read loop. The platform emits an SSE
   * heartbeat every 15s, so a live connection is never silent for longer than
   * that; if no bytes arrive within this window the stream is treated as a
   * transport drop so the caller can retry instead of hanging indefinitely.
   * Set to 0 to disable. Default: 60000.
   */
  streamIdleTimeoutMs?: number;
  /**
   * Extra headers sent on every request. The SDK's own headers
   * (`Authorization`, `Content-Type`, `X-Octavus-*`) take precedence.
   */
  headers?: Record<string, string>;
}

/** Client for interacting with the Octavus platform API */
export class OctavusClient {
  readonly agents: AgentsApi;
  readonly sessions: SessionsApi;
  readonly files: FilesApi;
  readonly workers: WorkersApi;
  /** Skills API - upload skill bundles and set their secrets with an organization key. */
  readonly skills: SkillsApi;
  /** Workforce Agents API - drive an OctoAgent with a per-agent key (oct_agt_*). */
  readonly workforce: WorkforceApi;
  /** Mint short-lived, scoped ephemeral tokens from a trusted key. */
  readonly tokens: TokensApi;
  readonly baseUrl: string;
  private readonly apiKey?: ApiKeyProvider;
  private readonly traceModelRequests: boolean;
  private readonly extraHeaders: Record<string, string>;

  constructor(config: OctavusClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.traceModelRequests = config.traceModelRequests ?? false;
    this.extraHeaders = { ...config.headers };

    const apiConfig: ApiClientConfig = {
      baseUrl: this.baseUrl,
      getHeaders: () => this.getHeaders(),
      maxRetries: config.maxRetries,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    };

    this.agents = new AgentsApi(apiConfig);
    this.sessions = new SessionsApi(apiConfig);
    this.files = new FilesApi(apiConfig);
    this.workers = new WorkersApi(apiConfig);
    this.skills = new SkillsApi(apiConfig);
    this.workforce = new WorkforceApi(apiConfig);
    this.tokens = new TokensApi(apiConfig);
  }

  /** Returns the platform URL for viewing a session's activity. */
  getSessionUrl(sessionId: string): string {
    return `${this.baseUrl}/platform/sessions/${sessionId}`;
  }

  /** Returns the platform URL for viewing an agent's editor. */
  getAgentUrl(agentId: string): string {
    return `${this.baseUrl}/platform/agents/${agentId}`;
  }

  async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...this.extraHeaders,
      'Content-Type': 'application/json',
    };

    const apiKey = typeof this.apiKey === 'function' ? await this.apiKey() : this.apiKey;
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    if (this.traceModelRequests) {
      headers['X-Octavus-Trace'] = 'true';
    }

    return headers;
  }
}
