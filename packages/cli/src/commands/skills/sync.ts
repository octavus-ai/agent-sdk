/**
 * octavus skills sync <path> [--env staging|production]
 * Sync a skill to the platform (creates or updates) and optionally push secrets.
 */

import type { Command } from 'commander';
import { loadConfig, ConfigError } from '@/config.js';
import { CliApi, ApiError } from '@/api.js';
import {
  packageSkillBundle,
  parseSkillFrontmatter,
  readSkillEnv,
  SkillFileError,
} from '@/skill-files.js';
import * as output from '@/output.js';

interface SkillSyncOptions {
  env?: string;
  json?: boolean;
  quiet?: boolean;
}

export function registerSkillSyncCommand(program: Command): void {
  program
    .command('sync <path>')
    .description('Sync skill to platform (creates or updates)')
    .option('--env <environment>', 'Environment for secrets (e.g., staging, production)')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (skillPath: string, options: SkillSyncOptions) => {
      try {
        await runSkillSync(skillPath, options);
      } catch (err) {
        handleError(err, options);
        process.exit(err instanceof ConfigError ? 2 : 1);
      }
    });
}

async function runSkillSync(skillPath: string, options: SkillSyncOptions): Promise<void> {
  const config = loadConfig();
  const api = new CliApi(config);

  // Read and validate skill
  if (!options.quiet && !options.json) {
    output.info(`Reading skill from ${output.cyan(skillPath)}...`);
  }

  const frontmatter = await parseSkillFrontmatter(skillPath);

  if (!options.quiet && !options.json) {
    output.info(`Packaging ${output.bold(frontmatter.name)}...`);
  }

  // Package and upload bundle
  const bundle = await packageSkillBundle(skillPath);
  const syncResult = await api.syncSkill(bundle);

  if (!options.quiet && !options.json) {
    const action = syncResult.created ? 'Created' : 'Updated';
    output.success(`${action}: ${output.bold(syncResult.slug)}`);
    output.keyValue('Skill ID', syncResult.skillId);
  }

  // Handle secrets
  let secretCount = 0;
  const envSecrets = await readSkillEnv(skillPath, options.env);

  if (envSecrets && Object.keys(envSecrets).length > 0) {
    // Cross-check against declared secrets in frontmatter
    if (frontmatter.secrets && !options.quiet && !options.json) {
      const declaredNames = new Set(frontmatter.secrets.map((s) => s.name));
      const envNames = Object.keys(envSecrets);

      for (const name of envNames) {
        if (!declaredNames.has(name)) {
          output.warning(`Secret ${output.yellow(name)} in .env but not declared in SKILL.md`);
        }
      }

      for (const declared of frontmatter.secrets) {
        if (declared.required !== false && !envSecrets[declared.name]) {
          output.warning(
            `Required secret ${output.yellow(declared.name)} declared in SKILL.md but missing from .env`,
          );
        }
      }
    }

    if (!options.quiet && !options.json) {
      output.info(`Pushing ${Object.keys(envSecrets).length} secret(s)...`);
    }

    const secretsResult = await api.upsertSkillSecrets(syncResult.skillId, envSecrets);
    secretCount = secretsResult.updated.length;

    if (!options.quiet && !options.json) {
      output.success(`${secretCount} secret(s) updated`);
    }
  }

  if (options.json) {
    output.json({
      slug: syncResult.slug,
      skillId: syncResult.skillId,
      created: syncResult.created,
      secretsUpdated: secretCount,
    });
  }
}

function getErrorCode(err: unknown): string {
  if (err instanceof ConfigError) return 'CONFIG_ERROR';
  if (err instanceof SkillFileError) return 'FILE_ERROR';
  if (err instanceof ApiError) return 'API_ERROR';
  return 'UNKNOWN';
}

function handleError(err: unknown, options: SkillSyncOptions): void {
  if (options.json === true) {
    output.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      code: getErrorCode(err),
    });
    return;
  }

  if (err instanceof ConfigError) {
    output.error(err.message);
  } else if (err instanceof SkillFileError) {
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
