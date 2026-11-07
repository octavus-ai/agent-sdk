/**
 * octavus get <slug>
 * Get agent details by slug
 */

import type { Command } from 'commander';
import { loadConfig, ConfigError } from '@/config.js';
import { CliApi, ApiError } from '@/api.js';
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
        handleError(err, options);
        process.exit(err instanceof ConfigError ? 2 : 1);
      }
    });
}

async function runGet(slug: string, options: GetOptions): Promise<void> {
  const config = loadConfig();
  const api = new CliApi(config);

  const agent = await api.getAgent(slug);

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
  output.success(`Agent: ${output.bold(agent.settings.name)}`);
  output.separator();
  output.keyValue('Slug', agent.settings.slug);
  output.keyValue('ID', agent.id);
  output.keyValue('Format', agent.settings.format);
  if (agent.settings.description) {
    output.keyValue('Description', agent.settings.description);
  }
  output.separator();
  output.keyValue(
    'Prompts',
    agent.prompts.length > 0 ? agent.prompts.map((p) => p.name).join(', ') : '(none)',
  );
}

function getErrorCode(err: unknown): string {
  if (err instanceof ConfigError) return 'CONFIG_ERROR';
  if (err instanceof ApiError) return 'API_ERROR';
  return 'UNKNOWN';
}

function handleError(err: unknown, options: GetOptions): void {
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
