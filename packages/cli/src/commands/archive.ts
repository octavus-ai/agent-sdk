/**
 * octavus archive <slug>
 * Archive an agent (soft delete)
 */

import type { Command } from 'commander';
import { loadConfig, ConfigError } from '@/config.js';
import { CliApi, ApiError } from '@/api.js';
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
        handleError(err, options);
        process.exit(err instanceof ConfigError ? 2 : 1);
      }
    });
}

async function runArchive(slug: string, options: ArchiveOptions): Promise<void> {
  const config = loadConfig();
  const api = new CliApi(config);

  if (!options.quiet && !options.json) {
    output.info(`Archiving ${output.bold(slug)}...`);
  }

  const result = await api.archiveAgent(slug);

  if (options.json) {
    output.json({
      slug,
      agentId: result.agentId,
      archived: true,
    });
  } else {
    output.success(`Archived: ${output.bold(slug)}`);
    output.keyValue('Agent ID', result.agentId);
  }
}

function getErrorCode(err: unknown): string {
  if (err instanceof ConfigError) return 'CONFIG_ERROR';
  if (err instanceof ApiError) return 'API_ERROR';
  return 'UNKNOWN';
}

function handleError(err: unknown, options: ArchiveOptions): void {
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
  } else if (err instanceof Error) {
    output.error(err.message);
  } else {
    output.error('An unknown error occurred');
  }
}
