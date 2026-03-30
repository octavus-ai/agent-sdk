/**
 * API client for the CLI.
 * Thin wrapper around fetch for Octavus platform API calls.
 */

import { z } from 'zod';
import type { CliConfig } from '@/config.js';
import type { AgentDefinition } from '@/agent-files.js';

/** API error response */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Agent summary from list endpoint */
export interface Agent {
  slug: string;
  id: string;
  name: string;
  description: string | null;
  format: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
}

/** Full agent definition from get endpoint */
export interface AgentDetails {
  settings: {
    slug: string;
    name: string;
    description?: string;
    format: 'interactive' | 'worker';
  };
  protocol: string;
  prompts: { name: string; content: string }[];
  references: { name: string; description: string; content: string }[];
  id: string;
}

/** Validation error detail */
export interface ValidationErrorDetail {
  message: string;
  path?: string;
  severity: 'error' | 'warning';
}

/** Validation result from validate endpoint */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
  warnings: ValidationErrorDetail[];
}

/** Sync result from create/update endpoints */
export interface SyncResult {
  agentId: string;
  created: boolean;
}

/** Archive result from delete endpoint */
export interface ArchiveResult {
  agentId: string;
  message: string;
}

// Response schemas for validation
const agentSchema = z.object({
  slug: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  format: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  projectId: z.string(),
});

const agentsResponseSchema = z.object({
  agents: z.array(agentSchema),
});

const agentDefinitionSchema = z.object({
  settings: z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().optional(),
    format: z.enum(['interactive', 'worker']),
  }),
  protocol: z.string(),
  prompts: z.array(z.object({ name: z.string(), content: z.string() })),
  references: z
    .array(z.object({ name: z.string(), description: z.string(), content: z.string() }))
    .default([]),
  id: z.string(),
});

const validationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(
    z.object({
      message: z.string(),
      path: z.string().optional(),
      severity: z.enum(['error', 'warning']),
    }),
  ),
  warnings: z.array(
    z.object({
      message: z.string(),
      path: z.string().optional(),
      severity: z.enum(['error', 'warning']),
    }),
  ),
});

const createResponseSchema = z.object({
  agentId: z.string(),
  message: z.string(),
});

const updateResponseSchema = z.object({
  agentId: z.string(),
  message: z.string(),
});

const archiveResponseSchema = z.object({
  agentId: z.string(),
  message: z.string(),
});

/** Skill sync result from POST /api/skills */
export interface SkillSyncResult {
  skillId: string;
  slug: string;
  created: boolean;
}

/** Skill secrets upsert result from PUT /api/skills/:id/secrets */
export interface SkillSecretsResult {
  updated: string[];
}

const skillSyncResultSchema = z.object({
  skillId: z.string(),
  slug: z.string(),
  created: z.boolean(),
});

const skillSecretsResultSchema = z.object({
  updated: z.array(z.string()),
});

export class CliApi {
  constructor(private readonly config: CliConfig) {}

  /** List all agents in the project */
  async listAgents(): Promise<Agent[]> {
    const response = await this.request('GET', '/api/agents');
    const data = agentsResponseSchema.parse(response);
    return data.agents;
  }

  /** Get agent by slug */
  async getAgent(slug: string): Promise<AgentDetails | null> {
    try {
      const response = await this.request('GET', `/api/agents/${slug}?by=slug`);
      return agentDefinitionSchema.parse(response);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /** Validate agent definition (dry-run) */
  async validateAgent(definition: AgentDefinition): Promise<ValidationResult> {
    const response = await this.request('POST', '/api/agents/validate', definition);
    return validationResultSchema.parse(response);
  }

  /** Create a new agent */
  async createAgent(definition: AgentDefinition): Promise<string> {
    const response = await this.request('POST', '/api/agents', definition);
    const data = createResponseSchema.parse(response);
    return data.agentId;
  }

  /** Update an existing agent by slug */
  async updateAgent(slug: string, definition: AgentDefinition): Promise<string> {
    // Exclude slug from settings (it's the identifier in the URL)
    const { slug: _slug, ...settings } = definition.settings;

    const response = await this.request('PATCH', `/api/agents/${slug}?by=slug`, {
      settings,
      protocol: definition.protocol,
      prompts: definition.prompts,
      references: definition.references,
    });
    const data = updateResponseSchema.parse(response);
    return data.agentId;
  }

  /** Archive an agent by slug */
  async archiveAgent(slug: string): Promise<ArchiveResult> {
    const response = await this.request('DELETE', `/api/agents/${slug}?by=slug`);
    return archiveResponseSchema.parse(response);
  }

  /** Upload a skill bundle (create or update) */
  async syncSkill(bundle: Buffer, visibility?: string): Promise<SkillSyncResult> {
    const formData = new FormData();
    formData.append('file', new Blob([bundle]), 'skill.zip');
    if (visibility) {
      formData.append('visibility', visibility);
    }
    const response = await this.requestMultipart('POST', '/api/skills', formData);
    return skillSyncResultSchema.parse(response);
  }

  /** Bulk upsert skill secrets */
  async upsertSkillSecrets(
    skillId: string,
    secrets: Record<string, string>,
  ): Promise<SkillSecretsResult> {
    const response = await this.request('PUT', `/api/skills/${skillId}/secrets`, { secrets });
    return skillSecretsResultSchema.parse(response);
  }

  /** Sync agent (create or update) */
  async syncAgent(definition: AgentDefinition): Promise<SyncResult> {
    const existing = await this.getAgent(definition.settings.slug);

    if (existing) {
      const agentId = await this.updateAgent(definition.settings.slug, definition);
      return { agentId, created: false };
    }

    const agentId = await this.createAgent(definition);
    return { agentId, created: true };
  }

  private async requestMultipart(
    method: string,
    path: string,
    formData: FormData,
  ): Promise<unknown> {
    const url = `${this.config.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: formData,
    });

    return await this.handleResponse(response);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.config.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return await this.handleResponse(response);
  }

  private async handleResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      if (isJson) {
        const errorData = (await response.json()) as { error?: string; code?: string };
        throw new ApiError(
          errorData.error ?? `Request failed with status ${response.status}`,
          response.status,
          errorData.code,
        );
      }
      throw new ApiError(`Request failed with status ${response.status}`, response.status);
    }

    if (!isJson) {
      throw new ApiError('Expected JSON response', response.status);
    }

    return await response.json();
  }
}
