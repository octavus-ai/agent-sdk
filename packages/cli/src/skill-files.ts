/**
 * Skill file reading, packaging, and .env parsing.
 * Reads skill directories, creates ZIP bundles, and parses environment files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import JSZip from 'jszip';
import { parse as parseYaml } from 'yaml';

export class SkillFileError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(message);
    this.name = 'SkillFileError';
  }
}

export interface SkillFrontmatter {
  name: string;
  description?: string;
  version?: string;
  license?: string;
  author?: string;
  secrets?: { name: string; description?: string; required?: boolean }[];
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

const EXCLUDED_PATTERNS = ['.env', '.env.', '.git', 'node_modules', '.DS_Store'];

function isExcluded(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return parts.some((part) =>
    EXCLUDED_PATTERNS.some((pattern) => part === pattern || part.startsWith(pattern)),
  );
}

/**
 * Parse SKILL.md frontmatter to extract metadata.
 */
export async function parseSkillFrontmatter(skillPath: string): Promise<SkillFrontmatter> {
  const skillMdPath = path.join(skillPath, 'SKILL.md');

  let content: string;
  try {
    content = await fs.readFile(skillMdPath, 'utf-8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new SkillFileError('SKILL.md not found', skillMdPath);
    }
    throw err;
  }

  const match = FRONTMATTER_REGEX.exec(content);
  if (!match?.[1]) {
    throw new SkillFileError('SKILL.md is missing YAML frontmatter', skillMdPath);
  }

  const frontmatter = parseYaml(match[1]) as Record<string, unknown>;

  if (typeof frontmatter.name !== 'string' || frontmatter.name.length === 0) {
    throw new SkillFileError('SKILL.md frontmatter must have a "name" field', skillMdPath);
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description as string | undefined,
    version: frontmatter.version as string | undefined,
    license: frontmatter.license as string | undefined,
    author: frontmatter.author as string | undefined,
    secrets: frontmatter.secrets as SkillFrontmatter['secrets'],
  };
}

/**
 * Recursively collect all files in a directory, returning relative paths.
 */
async function collectFiles(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (isExcluded(relativePath)) continue;

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, baseDir)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Package a skill directory into a ZIP buffer.
 * Excludes .env files, .git, and node_modules.
 */
export async function packageSkillBundle(skillPath: string): Promise<Buffer> {
  const resolvedPath = path.resolve(skillPath);

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new SkillFileError(`Not a directory: ${resolvedPath}`);
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new SkillFileError(`Directory not found: ${resolvedPath}`);
    }
    throw err;
  }

  // Validate SKILL.md exists
  await parseSkillFrontmatter(resolvedPath);

  const files = await collectFiles(resolvedPath, resolvedPath);
  const zip = new JSZip();

  for (const relativePath of files) {
    const fullPath = path.join(resolvedPath, relativePath);
    const content = await fs.readFile(fullPath);
    zip.file(relativePath, content);
  }

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

/**
 * Read a .env file from a skill directory.
 * Tries .env.{env} first, falls back to .env.
 * Returns null if no env file exists.
 */
export async function readSkillEnv(
  skillPath: string,
  env?: string,
): Promise<Record<string, string> | null> {
  const resolvedPath = path.resolve(skillPath);

  const candidates = env
    ? [path.join(resolvedPath, `.env.${env}`), path.join(resolvedPath, '.env')]
    : [path.join(resolvedPath, '.env')];

  for (const envPath of candidates) {
    try {
      const content = await fs.readFile(envPath, 'utf-8');
      const parsed = dotenv.parse(content);
      return parsed;
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') continue;
      throw err;
    }
  }

  return null;
}
