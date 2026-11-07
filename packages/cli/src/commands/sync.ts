/**
 * octavus sync <path>
 * Sync agent to platform (creates or updates)
 */

import type { Command } from 'commander';
import type { OctavusClient } from '@octavus/server-sdk';
import { loadConfig } from '@/config.js';
import { readAgentDefinition, type AgentDefinition } from '@/agent-files.js';
import { createClient, findAgentBySlug } from '@/client.js';
import { exitCode, reportError } from '@/errors.js';
import * as output from '@/output.js';

interface SyncOptions {
  json?: boolean;
  quiet?: boolean;
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync <path>')
    .description('Sync agent to platform (creates or updates)')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (agentPath: string, options: SyncOptions) => {
      try {
        await runSync(agentPath, options);
      } catch (err) {
        reportError(err, options);
        process.exit(exitCode(err));
      }
    });
}

async function runSync(agentPath: string, options: SyncOptions): Promise<void> {
  const client = createClient(loadConfig());

  if (!options.quiet && !options.json) {
    output.info(`Reading agent from ${output.cyan(agentPath)}...`);
  }

  const definition = await readAgentDefinition(agentPath);

  if (!options.quiet && !options.json) {
    output.info(`Syncing ${output.bold(definition.settings.slug)}...`);
  }

  const result = await syncAgent(client, definition);

  if (options.json) {
    output.json({
      slug: definition.settings.slug,
      agentId: result.agentId,
      created: result.created,
    });
  } else {
    const action = result.created ? 'Created' : 'Updated';
    output.success(`${action}: ${output.bold(definition.settings.slug)}`);
    output.keyValue('Agent ID', result.agentId);
  }
}

/**
 * Create the agent, or update the one with its slug. Both validate the whole
 * definition on the platform, so a sync never deploys an agent the editor
 * would refuse.
 */
async function syncAgent(
  client: OctavusClient,
  definition: AgentDefinition,
): Promise<{ agentId: string; created: boolean }> {
  const existing = await findAgentBySlug(client, definition.settings.slug);

  if (existing) {
    // The slug is the agent's identity and travels in the lookup, not the update.
    const { slug: _slug, ...settings } = definition.settings;
    const updated = await client.agents.update(existing.id, {
      settings,
      protocol: definition.protocol,
      prompts: definition.prompts,
      references: definition.references,
    });
    return { agentId: updated.id, created: false };
  }

  const created = await client.agents.create(definition);
  return { agentId: created.id, created: true };
}
