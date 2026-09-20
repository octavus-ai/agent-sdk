/**
 * Agent file reading from filesystem.
 * Reads settings.json, protocol.yaml, prompts/*.md, and references/*.md files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { resolveEntryKind, BrokenSymlinkError } from '@/dir-entries.js';

/** Agent settings from settings.json */
export interface AgentSettings {
  slug: string;
  name: string;
  description?: string;
  format: 'interactive' | 'worker';
}

/** Agent prompt from prompts/*.md */
export interface AgentPrompt {
  name: string;
  content: string;
}

/** Agent reference from references/*.md */
export interface AgentReference {
  name: string;
  description: string;
  content: string;
}

/** Complete agent definition read from filesystem */
export interface AgentDefinition {
  settings: AgentSettings;
  protocol: string;
  prompts: AgentPrompt[];
  references: AgentReference[];
}

const agentSettingsSchema = z.object({
  slug: z.string().min(1, 'Slug is required'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  format: z.enum(['interactive', 'worker']),
});

export class AgentFileError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(message);
    this.name = 'AgentFileError';
  }
}

/**
 * Read agent definition from a directory.
 * Expects:
 *   - settings.json (required)
 *   - protocol.yaml (required)
 *   - prompts/**\/*.md (optional, supports nested directories)
 *   - references/*.md (optional, YAML frontmatter with description)
 */
export async function readAgentDefinition(agentPath: string): Promise<AgentDefinition> {
  const resolvedPath = path.resolve(agentPath);

  // Check if directory exists
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new AgentFileError(`Not a directory: ${resolvedPath}`);
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new AgentFileError(`Directory not found: ${resolvedPath}`);
    }
    throw err;
  }

  // Read settings.json
  const settingsPath = path.join(resolvedPath, 'settings.json');
  const settings = await readSettings(settingsPath);

  // Read protocol.yaml
  const protocolPath = path.join(resolvedPath, 'protocol.yaml');
  const protocol = await readProtocol(protocolPath);

  // Read prompts
  const promptsPath = path.join(resolvedPath, 'prompts');
  const prompts = await readPrompts(promptsPath);

  // Read references
  const referencesPath = path.join(resolvedPath, 'references');
  const references = await readReferences(referencesPath);

  return { settings, protocol, prompts, references };
}

async function readSettings(filePath: string): Promise<AgentSettings> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const json: unknown = JSON.parse(content);
    const result = agentSettingsSchema.safeParse(json);

    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join(', ');
      throw new AgentFileError(`Invalid settings.json: ${issues}`, filePath);
    }

    return result.data;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new AgentFileError('settings.json not found', filePath);
    }
    if (err instanceof SyntaxError) {
      throw new AgentFileError(`Invalid JSON in settings.json: ${err.message}`, filePath);
    }
    throw err;
  }
}

async function readProtocol(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new AgentFileError('protocol.yaml not found', filePath);
    }
    throw err;
  }
}

async function readPrompts(
  promptsDir: string,
  relativePath = '',
  visited = new Set<string>(),
): Promise<AgentPrompt[]> {
  const prompts: AgentPrompt[] = [];

  try {
    // Guard against symlink cycles (a directory symlink pointing at an ancestor).
    const realDir = await fs.realpath(promptsDir);
    if (visited.has(realDir)) return prompts;
    visited.add(realDir);

    const entries = await fs.readdir(promptsDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const fullPath = path.join(promptsDir, entry.name);
      const kind = await resolveEntryKind(fullPath, entry);

      if (kind === 'directory') {
        const subPrompts = await readPrompts(fullPath, entryRelativePath, visited);
        prompts.push(...subPrompts);
      } else if (kind === 'file' && entry.name.endsWith('.md')) {
        const name = entryRelativePath.replace(/\.md$/, '');
        const content = await fs.readFile(fullPath, 'utf-8');
        prompts.push({ name, content });
      }
    }
  } catch (err) {
    if (err instanceof BrokenSymlinkError) {
      throw new AgentFileError(err.message, err.linkPath);
    }
    if ((err as { code?: string }).code !== 'ENOENT') {
      throw err;
    }
  }

  return prompts;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

const referenceFrontmatterSchema = z.object({
  description: z.string().min(1, 'Description is required'),
});

async function readReferences(referencesDir: string): Promise<AgentReference[]> {
  const references: AgentReference[] = [];

  try {
    const entries = await fs.readdir(referencesDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(referencesDir, entry.name);
      const kind = await resolveEntryKind(fullPath, entry);
      if (kind !== 'file' || !entry.name.endsWith('.md')) continue;

      const name = entry.name.replace(/\.md$/, '');
      const raw = await fs.readFile(fullPath, 'utf-8');
      const match = FRONTMATTER_REGEX.exec(raw);

      if (!match) {
        throw new AgentFileError(
          `Reference "${name}" is missing YAML frontmatter (---description: ...---)`,
          fullPath,
        );
      }

      const frontmatter = parseYaml(match[1]!) as unknown;
      const result = referenceFrontmatterSchema.safeParse(frontmatter);

      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message).join(', ');
        throw new AgentFileError(`Invalid frontmatter in reference "${name}": ${issues}`, fullPath);
      }

      references.push({
        name,
        description: result.data.description,
        content: match[2]!.trim(),
      });
    }
  } catch (err) {
    if (err instanceof BrokenSymlinkError) {
      throw new AgentFileError(err.message, err.linkPath);
    }
    if ((err as { code?: string }).code !== 'ENOENT') {
      throw err;
    }
  }

  return references;
}
