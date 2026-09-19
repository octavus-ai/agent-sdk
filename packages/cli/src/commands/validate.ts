/**
 * octavus validate <path>
 * Validate agent definition via API (dry-run, no changes saved)
 */

import type { Command } from 'commander';
import { loadConfig, ConfigError } from '@/config.js';
import { readAgentDefinition, AgentFileError } from '@/agent-files.js';
import { CliApi, ApiError } from '@/api.js';
import * as output from '@/output.js';

interface ValidateOptions {
  json?: boolean;
  quiet?: boolean;
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate <path>')
    .description('Validate agent definition (dry-run, no changes saved)')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (agentPath: string, options: ValidateOptions) => {
      try {
        await runValidate(agentPath, options);
      } catch (err) {
        handleError(err, options);
        process.exit(err instanceof ConfigError ? 2 : 1);
      }
    });
}

async function runValidate(agentPath: string, options: ValidateOptions): Promise<void> {
  const config = loadConfig();
  const api = new CliApi(config);

  // Read agent files
  if (!options.quiet && !options.json) {
    output.info(`Reading agent from ${output.cyan(agentPath)}...`);
  }

  const definition = await readAgentDefinition(agentPath);

  if (!options.quiet && !options.json) {
    output.info(`Validating ${output.bold(definition.settings.slug)}...`);
  }

  // Validate via API
  const result = await api.validateAgent(definition);

  // Output results
  if (options.json) {
    output.json({
      slug: definition.settings.slug,
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      info: result.info ?? [],
    });
  } else {
    if (result.valid) {
      output.success(`Agent ${output.bold(definition.settings.slug)} is valid`);
    } else {
      output.error(`Agent ${output.bold(definition.settings.slug)} has validation errors`);
    }

    // Show errors
    for (const err of result.errors) {
      const location = err.path ? ` (${output.gray(err.path)})` : '';
      output.error(`  ${err.message}${location}`);
    }

    // Show warnings
    for (const warn of result.warnings) {
      const location = warn.path ? ` (${output.gray(warn.path)})` : '';
      output.warning(`  ${warn.message}${location}`);
    }

    // Show info-level recommendations (best-practice guidance; never blocks)
    for (const item of result.info ?? []) {
      const location = item.path ? ` (${output.gray(item.path)})` : '';
      output.info(`  ${item.message}${location}`);
    }
  }

  // Exit with error code if validation failed
  if (!result.valid) {
    process.exit(1);
  }
}

function getErrorCode(err: unknown): string {
  if (err instanceof ConfigError) return 'CONFIG_ERROR';
  if (err instanceof AgentFileError) return 'FILE_ERROR';
  if (err instanceof ApiError) return 'API_ERROR';
  return 'UNKNOWN';
}

function handleError(err: unknown, options: ValidateOptions): void {
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
  } else if (err instanceof Error) {
    output.error(err.message);
  } else {
    output.error('An unknown error occurred');
  }
}
