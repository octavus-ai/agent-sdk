/**
 * The platform client the CLI commands run on: the Server SDK's, configured
 * from the CLI's environment.
 */

import { OctavusClient, type Agent, type AgentDefinition } from '@octavus/server-sdk';
import type { CliConfig } from '@/config.js';

export function createClient(config: CliConfig): OctavusClient {
  return new OctavusClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
}

/** The agent with this slug in the project, or null when there is none. */
export async function findAgentBySlug(client: OctavusClient, slug: string): Promise<Agent | null> {
  const [agent] = await client.agents.list({ slug });
  return agent ?? null;
}

/** The definition of the agent with this slug, or null when there is none. */
export async function getAgentBySlug(
  client: OctavusClient,
  slug: string,
): Promise<AgentDefinition | null> {
  const agent = await findAgentBySlug(client, slug);
  return agent ? await client.agents.get(agent.id) : null;
}
