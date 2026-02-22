/**
 * Octavus CLI - Validate and sync agent definitions
 *
 * Commands:
 *   octavus validate <path>  - Validate agent definition (dry-run)
 *   octavus sync <path>      - Sync agent to platform (creates or updates)
 *   octavus list             - List all agents in the project
 *   octavus get <slug>       - Get agent details by slug
 *   octavus archive <slug>   - Archive an agent (soft delete)
 *
 * Global Options:
 *   --env <file>  - Load environment from a specific file (default: .env)
 *
 * Environment:
 *   OCTAVUS_CLI_API_KEY - API key with agent management permissions
 *   OCTAVUS_API_KEY     - Fallback API key
 *   OCTAVUS_API_URL     - Optional, defaults to https://octavus.ai
 */

import dotenv from 'dotenv';
import { Command } from 'commander';
import { registerValidateCommand } from '@/commands/validate.js';
import { registerSyncCommand } from '@/commands/sync.js';
import { registerListCommand } from '@/commands/list.js';
import { registerGetCommand } from '@/commands/get.js';
import { registerArchiveCommand } from '@/commands/archive.js';

// Pre-parse to extract --env option before loading environment
const envIndex = process.argv.indexOf('--env');
const envFile = envIndex !== -1 && process.argv[envIndex + 1] ? process.argv[envIndex + 1] : '.env';

// Load environment file
dotenv.config({ path: envFile });

const program = new Command();

program
  .name('octavus')
  .description('CLI for validating and syncing Octavus agent definitions')
  .version('0.1.0')
  .option('--env <file>', 'Load environment from a specific file', '.env');

// Register commands
registerValidateCommand(program);
registerSyncCommand(program);
registerListCommand(program);
registerGetCommand(program);
registerArchiveCommand(program);

// Parse and run
program.parse();
