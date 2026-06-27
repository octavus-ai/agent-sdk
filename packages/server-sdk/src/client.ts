import type { ApiClientConfig } from '@/base-api-client.js';
import { AgentsApi } from '@/agents.js';
import { AgentSessionsApi } from '@/agent-sessions.js';
import { FilesApi } from '@/files.js';
import { WorkersApi } from '@/workers.js';
import { WorkforceApi } from '@/workforce.js';

/**
 * Wire-format major version this SDK can parse.
 *
 * Sent on every request as `X-Octavus-Sdk-Version` so the platform
 * serves a shape we understand. Bump together with the SDK's major
 * version whenever a wire-incompatible change lands.
 */
const SDK_WIRE_VERSION = '4';

export interface OctavusClientConfig {
  baseUrl: string;
  apiKey?: string;
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
}

/** Client for interacting with the Octavus platform API */
export class OctavusClient {
  readonly agents: AgentsApi;
  readonly agentSessions: AgentSessionsApi;
  readonly files: FilesApi;
  readonly workers: WorkersApi;
  /** Workforce Agents API - drive an OctoAgent with a per-agent key (oct_agt_*). */
  readonly workforce: WorkforceApi;
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly traceModelRequests: boolean;

  constructor(config: OctavusClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.traceModelRequests = config.traceModelRequests ?? false;

    const apiConfig: ApiClientConfig = {
      baseUrl: this.baseUrl,
      getHeaders: () => this.getHeaders(),
      maxRetries: config.maxRetries,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    };

    this.agents = new AgentsApi(apiConfig);
    this.agentSessions = new AgentSessionsApi(apiConfig);
    this.files = new FilesApi(apiConfig);
    this.workers = new WorkersApi(apiConfig);
    this.workforce = new WorkforceApi(apiConfig);
  }

  /** Returns the platform URL for viewing a session's activity. */
  getSessionUrl(sessionId: string): string {
    return `${this.baseUrl}/platform/sessions/${sessionId}`;
  }

  /** Returns the platform URL for viewing an agent's editor. */
  getAgentUrl(agentId: string): string {
    return `${this.baseUrl}/platform/agents/${agentId}`;
  }

  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Octavus-Sdk-Version': SDK_WIRE_VERSION,
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    if (this.traceModelRequests) {
      headers['X-Octavus-Trace'] = 'true';
    }

    return headers;
  }
}
