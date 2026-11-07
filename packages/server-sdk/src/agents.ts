import { BaseApiClient } from '@/base-api-client.js';
import {
  agentsResponseSchema,
  agentDefinitionSchema,
  agentValidationResultSchema,
  type Agent,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentUpdateInput,
  type AgentValidationResult,
} from '@/agent-types.js';

export interface ListAgentsOptions {
  /** Only the agent with this slug: the way to resolve a slug to an id. */
  slug?: string;
}

/**
 * API for reading and managing agent definitions.
 *
 * Paths carry agent ids; a slug is a filter on the list. Reading needs the
 * agents or the sessions permission; creating, updating, archiving, and
 * validating need the agents permission (the `octavus` CLI is built on them).
 */
export class AgentsApi extends BaseApiClient {
  /** List the project's agents, newest first, optionally narrowed to one slug. */
  async list(options: ListAgentsOptions = {}): Promise<Agent[]> {
    const response = await this.httpGet('/api/v1/agents', agentsResponseSchema, {
      slug: options.slug,
    });
    return response.agents;
  }

  /** Get an agent's definition by ID */
  async get(agentId: string): Promise<AgentDefinition> {
    return await this.httpGet(`/api/v1/agents/${agentId}`, agentDefinitionSchema);
  }

  /**
   * Create an agent from a full definition. The definition is validated as a
   * whole; an invalid one fails with a `422` carrying the issues.
   *
   * @throws OctavusError with code `CONFLICT` when the slug is taken
   */
  async create(definition: AgentDefinitionInput): Promise<AgentDefinition> {
    return await this.httpPost('/api/v1/agents', definition, agentDefinitionSchema);
  }

  /**
   * Update an agent. What the update leaves out keeps its value; the resulting
   * definition is validated as fully as a create, so an update never deploys
   * an agent a create would refuse.
   */
  async update(agentId: string, update: AgentUpdateInput): Promise<AgentDefinition> {
    return await this.httpPatch(`/api/v1/agents/${agentId}`, update, agentDefinitionSchema);
  }

  /** Archive an agent (its sessions are kept). Returns the agent as it was. */
  async archive(agentId: string): Promise<AgentDefinition> {
    return await this.httpDelete(`/api/v1/agents/${agentId}`, agentDefinitionSchema);
  }

  /** Validate a definition without saving it: every diagnostic at its severity. */
  async validate(definition: AgentDefinitionInput): Promise<AgentValidationResult> {
    return await this.httpPost('/api/v1/agents/validate', definition, agentValidationResultSchema);
  }
}
