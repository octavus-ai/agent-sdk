/**
 * octavus validate <path>
 * Validate agent definition via API (dry-run, no changes saved)
 */

import type { Command } from 'commander';
import { loadConfig } from '@/config.js';
import { readAgentDefinition } from '@/agent-files.js';
import { createClient } from '@/client.js';
import { exitCode, reportError } from '@/errors.js';
import { renderIssues } from '@/issues.js';
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
        reportError(err, options);
        process.exit(exitCode(err));
      }
    });
}

async function runValidate(agentPath: string, options: ValidateOptions): Promise<void> {
  const client = createClient(loadConfig());

  if (!options.quiet && !options.json) {
    output.info(`Reading agent from ${output.cyan(agentPath)}...`);
  }

  const definition = await readAgentDefinition(agentPath);

  if (!options.quiet && !options.json) {
    output.info(`Validating ${output.bold(definition.settings.slug)}...`);
  }

  const result = await client.agents.validate(definition);

  if (options.json) {
    output.json({
      slug: definition.settings.slug,
      valid: result.valid,
      issues: result.issues,
    });
  } else {
    if (result.valid) {
      output.success(`Agent ${output.bold(definition.settings.slug)} is valid`);
    } else {
      output.error(`Agent ${output.bold(definition.settings.slug)} has validation errors`);
    }

    renderIssues(result.issues);
  }

  // Only errors fail the command; warnings and info never block.
  if (!result.valid) {
    process.exit(1);
  }
}
