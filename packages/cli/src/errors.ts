/**
 * How a command reports the error it failed with: a JSON object in `--json`
 * mode, a line per fact otherwise. A platform error names its status and the
 * request ID to quote to support; a file error names the file.
 */

import { OctavusError } from '@octavus/server-sdk';
import { ConfigError } from '@/config.js';
import { AgentFileError } from '@/agent-files.js';
import { SkillFileError } from '@/skill-files.js';
import * as output from '@/output.js';

export function errorCode(err: unknown): string {
  if (err instanceof ConfigError) return 'CONFIG_ERROR';
  if (err instanceof AgentFileError || err instanceof SkillFileError) return 'FILE_ERROR';
  if (OctavusError.isInstance(err)) return 'API_ERROR';
  return 'UNKNOWN';
}

export function reportError(err: unknown, options: { json?: boolean }): void {
  if (options.json === true) {
    output.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      code: errorCode(err),
    });
    return;
  }

  if (err instanceof AgentFileError || err instanceof SkillFileError) {
    output.error(err.message);
    if (err.filePath !== undefined) {
      output.dim(`  File: ${err.filePath}`);
    }
  } else if (OctavusError.isInstance(err)) {
    output.error(`API error: ${err.message}`);
    if (err.status !== undefined) {
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

/** The process exit code a failed command ends with: 2 for a misconfiguration, 1 otherwise. */
export function exitCode(err: unknown): number {
  return err instanceof ConfigError ? 2 : 1;
}
