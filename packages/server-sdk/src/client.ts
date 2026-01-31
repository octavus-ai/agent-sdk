import type { ApiClientConfig } from '@/base-api-client.js';
import { AgentsApi } from '@/agents.js';
import { AgentSessionsApi } from '@/agent-sessions.js';
import { FilesApi } from '@/files.js';
import { WorkersApi } from '@/workers.js';

export interface OctavusClientConfig {
  baseUrl: string;
  apiKey?: string;
}

/** Client for interacting with the Octavus platform API */
export class OctavusClient {
  readonly agents: AgentsApi;
  readonly agentSessions: AgentSessionsApi;
  readonly files: FilesApi;
  readonly workers: WorkersApi;
  readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: OctavusClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;

    const apiConfig: ApiClientConfig = {
      baseUrl: this.baseUrl,
      getHeaders: () => this.getHeaders(),
    };

    this.agents = new AgentsApi(apiConfig);
    this.agentSessions = new AgentSessionsApi(apiConfig);
    this.files = new FilesApi(apiConfig);
    this.workers = new WorkersApi(apiConfig);
  }

  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}
