/**
 * octavus get <slug>
 * Get agent details by slug
 */

import type { Command } from 'commander';
import { loadConfig } from '@/config.js';
import { createClient, getAgentBySlug } from '@/client.js';
import { exitCode, reportError } from '@/errors.js';
import * as output from '@/output.js';

interface GetOptions {
  json?: boolean;
  quiet?: boolean;
}

export function registerGetCommand(program: Command): void {
  program
    .command('get <slug>')
    .description('Get agent details by slug')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (slug: string, options: GetOptions) => {
      try {
        await runGet(slug, options);
      } catch (err) {
        reportError(err, options);
        process.exit(exitCode(err));
      }
    });
}

async function runGet(slug: string, options: GetOptions): Promise<void> {
  const client = createClient(loadConfig());

  const agent = await getAgentBySlug(client, slug);

  if (!agent) {
    if (options.json) {
      output.json({ error: `Agent not found: ${slug}`, code: 'NOT_FOUND' });
    } else {
      output.error(`Agent not found: ${slug}`);
    }
    process.exit(1);
  }

  if (options.json) {
    output.json(agent);
    return;
  }

  // Print agent details
  output.separator();
  output.success(`Agent: ${output.bold(agent.name)}`);
  output.separator();
  output.keyValue('Slug', agent.slug);
  output.keyValue('ID', agent.id);
  output.keyValue('Format', agent.format);
  if (agent.description) {
    output.keyValue('Description', agent.description);
  }
  output.separator();
  output.keyValue(
    'Prompts',
    agent.prompts.length > 0 ? agent.prompts.map((p) => p.name).join(', ') : '(none)',
  );
}
