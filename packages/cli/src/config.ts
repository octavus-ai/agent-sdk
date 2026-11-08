/**
 * Configuration loading for the CLI.
 * Handles environment variables and defaults.
 */

import { DEFAULT_BASE_URL } from '@octavus/server-sdk';

export interface CliConfig {
  apiKey: string;
  baseUrl: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Load CLI configuration from environment variables.
 * API key resolution: OCTAVUS_CLI_API_KEY > OCTAVUS_API_KEY
 */
export function loadConfig(): CliConfig {
  const apiKey = process.env.OCTAVUS_CLI_API_KEY ?? process.env.OCTAVUS_API_KEY;

  if (!apiKey) {
    throw new ConfigError(
      'No API key found. Set OCTAVUS_CLI_API_KEY or OCTAVUS_API_KEY environment variable.',
    );
  }

  const baseUrl = process.env.OCTAVUS_API_URL ?? DEFAULT_BASE_URL;

  return { apiKey, baseUrl };
}
