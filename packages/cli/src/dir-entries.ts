/**
 * Directory entry helpers that follow symlinks.
 *
 * `fs.readdir(dir, { withFileTypes: true })` returns `Dirent`s whose
 * `isFile()` / `isDirectory()` describe the entry on disk - both are `false`
 * for a symlink (only `isSymbolicLink()` is `true`). These helpers resolve a
 * symlink to its target so linked files and directories are treated as the
 * real files/directories they point to, letting consumers share references,
 * prompts, and skill files across agents via symlinks.
 */

import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';

export type EntryKind = 'file' | 'directory' | 'other';

/**
 * Thrown when a directory entry is a symlink whose target no longer exists,
 * so a broken link fails loudly instead of being silently skipped.
 */
export class BrokenSymlinkError extends Error {
  constructor(public readonly linkPath: string) {
    super(`Broken symlink: ${linkPath}`);
    this.name = 'BrokenSymlinkError';
  }
}

/**
 * Resolve a directory entry to its target kind, following symlinks.
 * Throws BrokenSymlinkError on a broken symlink rather than silently skipping it.
 */
export async function resolveEntryKind(fullPath: string, entry: Dirent): Promise<EntryKind> {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';

  if (entry.isSymbolicLink()) {
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) return 'file';
      if (stat.isDirectory()) return 'directory';
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        throw new BrokenSymlinkError(fullPath);
      }
      throw err;
    }
  }

  return 'other';
}
