/**
 * Agent file reading from filesystem.
 * Reads settings.json, protocol.yaml, and prompts/*.md files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

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

/** Complete agent definition read from filesystem */
export interface AgentDefinition {
  settings: AgentSettings;
  protocol: string;
  prompts: AgentPrompt[];
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

  return { settings, protocol, prompts };
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

async function readPrompts(promptsDir: string, relativePath = ''): Promise<AgentPrompt[]> {
  const prompts: AgentPrompt[] = [];

  try {
    const entries = await fs.readdir(promptsDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const subPrompts = await readPrompts(path.join(promptsDir, entry.name), entryRelativePath);
        prompts.push(...subPrompts);
      } else if (entry.name.endsWith('.md')) {
        const name = entryRelativePath.replace(/\.md$/, '');
        const content = await fs.readFile(path.join(promptsDir, entry.name), 'utf-8');
        prompts.push({ name, content });
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') {
      throw err;
    }
  }

  return prompts;
}
