/**
 * octavus list
 * List all agents in the project
 */

import type { Command } from 'commander';
import { loadConfig, ConfigError } from '@/config.js';
import { CliApi, ApiError } from '@/api.js';
import * as output from '@/output.js';

interface ListOptions {
  json?: boolean;
  quiet?: boolean;
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all agents in the project')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (options: ListOptions) => {
      try {
        await runList(options);
      } catch (err) {
        handleError(err, options);
        process.exit(err instanceof ConfigError ? 2 : 1);
      }
    });
}

async function runList(options: ListOptions): Promise<void> {
  const config = loadConfig();
  const api = new CliApi(config);

  const agents = await api.listAgents();

  if (options.json) {
    output.json({ agents });
    return;
  }

  if (agents.length === 0) {
    output.info('No agents found');
    return;
  }

  // Print header
  output.separator();
  output.tableRow(
    [output.bold('SLUG'), output.bold('NAME'), output.bold('FORMAT'), output.bold('ID')],
    [20, 30, 12, 36],
  );
  output.dim('─'.repeat(100));

  // Print agents
  for (const agent of agents) {
    output.tableRow([agent.slug, agent.name, agent.format, agent.id], [20, 30, 12, 36]);
  }

  output.separator();
  output.dim(`${agents.length} agent(s)`);
}

function getErrorCode(err: unknown): string {
  if (err instanceof ConfigError) return 'CONFIG_ERROR';
  if (err instanceof ApiError) return 'API_ERROR';
  return 'UNKNOWN';
}

function handleError(err: unknown, options: ListOptions): void {
  if (options.json === true) {
    output.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      code: getErrorCode(err),
    });
    return;
  }

  if (err instanceof ConfigError) {
    output.error(err.message);
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
