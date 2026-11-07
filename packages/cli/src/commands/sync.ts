/**
 * octavus sync <path>
 * Sync agent to platform (creates or updates)
 */

import type { Command } from 'commander';
import { loadConfig, ConfigError } from '@/config.js';
import { readAgentDefinition, AgentFileError } from '@/agent-files.js';
import { CliApi, ApiError } from '@/api.js';
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
        handleError(err, options);
        process.exit(err instanceof ConfigError ? 2 : 1);
      }
    });
}

async function runSync(agentPath: string, options: SyncOptions): Promise<void> {
  const config = loadConfig();
  const api = new CliApi(config);

  // Read agent files
  if (!options.quiet && !options.json) {
    output.info(`Reading agent from ${output.cyan(agentPath)}...`);
  }

  const definition = await readAgentDefinition(agentPath);

  if (!options.quiet && !options.json) {
    output.info(`Syncing ${output.bold(definition.settings.slug)}...`);
  }

  // Sync to platform
  const result = await api.syncAgent(definition);

  // Output results
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

function getErrorCode(err: unknown): string {
  if (err instanceof ConfigError) return 'CONFIG_ERROR';
  if (err instanceof AgentFileError) return 'FILE_ERROR';
  if (err instanceof ApiError) return 'API_ERROR';
  return 'UNKNOWN';
}

function handleError(err: unknown, options: SyncOptions): void {
  if (options.json === true) {
    output.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      code: getErrorCode(err),
    });
    return;
  }

  if (err instanceof ConfigError) {
    output.error(err.message);
  } else if (err instanceof AgentFileError) {
    output.error(err.message);
    if (err.filePath !== undefined) {
      output.dim(`  File: ${err.filePath}`);
    }
  } else if (err instanceof ApiError) {
    output.error(`API error: ${err.message}`);
    if (err.status !== 0) {
      output.dim(`  Status: ${err.status}`);
    }
    if (err.requestId !== undefined) {
      output.dim(`  Request ID: ${err.requestId}`);
    }
  } else if (err instanceof Error) {
    output.error(err.message);
  } else {
    output.error('An unknown error occurred');
  }
}
