/**
 * octavus archive <slug>
 * Archive an agent (soft delete)
 */

import type { Command } from 'commander';
import { loadConfig } from '@/config.js';
import { createClient, findAgentBySlug } from '@/client.js';
import { exitCode, reportError } from '@/errors.js';
import * as output from '@/output.js';

interface ArchiveOptions {
  json?: boolean;
  quiet?: boolean;
}

export function registerArchiveCommand(program: Command): void {
  program
    .command('archive <slug>')
    .description('Archive an agent (soft delete)')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (slug: string, options: ArchiveOptions) => {
      try {
        await runArchive(slug, options);
      } catch (err) {
        reportError(err, options);
        process.exit(exitCode(err));
      }
    });
}

async function runArchive(slug: string, options: ArchiveOptions): Promise<void> {
  const client = createClient(loadConfig());

  if (!options.quiet && !options.json) {
    output.info(`Archiving ${output.bold(slug)}...`);
  }

  const agent = await findAgentBySlug(client, slug);
  if (!agent) {
    if (options.json) {
      output.json({ error: `Agent not found: ${slug}`, code: 'NOT_FOUND' });
    } else {
      output.error(`Agent not found: ${slug}`);
    }
    process.exit(1);
  }

  const archived = await client.agents.archive(agent.id);

  if (options.json) {
    output.json({
      slug,
      agentId: archived.id,
      archived: true,
    });
  } else {
    output.success(`Archived: ${output.bold(slug)}`);
    output.keyValue('Agent ID', archived.id);
  }
}
