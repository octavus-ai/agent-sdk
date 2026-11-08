/**
 * octavus list
 * List all agents in the project
 */

import type { Command } from 'commander';
import { loadConfig } from '@/config.js';
import { createClient } from '@/client.js';
import { exitCode, reportError } from '@/errors.js';
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
        reportError(err, options);
        process.exit(exitCode(err));
      }
    });
}

async function runList(options: ListOptions): Promise<void> {
  const client = createClient(loadConfig());

  const agents = await client.agents.list();

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
