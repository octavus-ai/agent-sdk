/**
 * octavus skills sync <path> [--env staging|production]
 * Sync a skill to the platform (creates or updates) and optionally push secrets.
 */

import type { Command } from 'commander';
import { loadConfig } from '@/config.js';
import { createClient } from '@/client.js';
import { exitCode, reportError } from '@/errors.js';
import { packageSkillBundle, parseSkillFrontmatter, readSkillEnv } from '@/skill-files.js';
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
        reportError(err, options);
        process.exit(exitCode(err));
      }
    });
}

async function runSkillSync(skillPath: string, options: SkillSyncOptions): Promise<void> {
  const client = createClient(loadConfig());

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
  const { skill, created } = await client.skills.sync(bundle);

  if (!options.quiet && !options.json) {
    const action = created ? 'Created' : 'Updated';
    output.success(`${action}: ${output.bold(skill.slug)}`);
    output.keyValue('Skill ID', skill.id);
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

    const updated = await client.skills.setSecrets(skill.id, envSecrets);
    secretCount = updated.length;

    if (!options.quiet && !options.json) {
      output.success(`${secretCount} secret(s) updated`);
    }
  }

  if (options.json) {
    output.json({
      slug: skill.slug,
      skillId: skill.id,
      created,
      secretsUpdated: secretCount,
    });
  }
}
