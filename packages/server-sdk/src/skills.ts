import { z } from 'zod';
import { BaseApiClient } from '@/base-api-client.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const skillVisibilitySchema = z.enum(['ORGANIZATION', 'PUBLIC']);

export const skillSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  description: z.string(),
  version: z.string(),
  visibility: skillVisibilitySchema,
  /** The project the skill is private to; null for an organization-wide skill. */
  projectId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const skillSecretsResponseSchema = z.looseObject({
  updated: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillVisibility = z.infer<typeof skillVisibilitySchema>;

/** A skill, as the platform stores it. */
export interface Skill {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  description: string;
  version: string;
  visibility: SkillVisibility;
  /** The project the skill is private to; null for an organization-wide skill. */
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSyncOptions {
  /** Who can see the skill. Defaults to `ORGANIZATION`; a project-scoped skill is always `ORGANIZATION`. */
  visibility?: SkillVisibility;
  /** Scope the skill privately to this project (and attach it) instead of making it organization-wide. */
  projectId?: string;
}

export interface SkillSyncResult {
  skill: Skill;
  /** True when the sync created the skill; false when it updated an existing one. */
  created: boolean;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * API for managing skills with an organization key carrying the skills
 * permission: uploading a skill bundle and setting its secrets.
 */
export class SkillsApi extends BaseApiClient {
  /**
   * Upload a skill bundle (the ZIP of a skill directory). Creates the skill,
   * or updates the one with the bundle's slug in the same scope.
   */
  async sync(bundle: Blob | Uint8Array, options: SkillSyncOptions = {}): Promise<SkillSyncResult> {
    const form = new FormData();
    form.append('file', toBlob(bundle), 'skill.zip');
    if (options.visibility) form.append('visibility', options.visibility);
    if (options.projectId) form.append('projectId', options.projectId);

    const { status, data } = await this.httpPostForm('/api/v1/skills', form, skillSchema);
    return { skill: data, created: status === 201 };
  }

  /**
   * Set a skill's secrets (name to plaintext value); each is created or
   * updated. Returns the names that were set.
   */
  async setSecrets(skillId: string, secrets: Record<string, string>): Promise<string[]> {
    const { updated } = await this.httpPut(
      `/api/v1/skills/${skillId}/secrets`,
      { secrets },
      skillSecretsResponseSchema,
    );
    return updated;
  }
}

/**
 * The bundle as a `Blob`. A `Uint8Array` is copied into a fresh buffer so a
 * view over a shared or oversized buffer (a Node `Buffer` from a pool) sends
 * exactly its bytes.
 */
function toBlob(bundle: Blob | Uint8Array): Blob {
  if (bundle instanceof Blob) return bundle;
  const bytes = new Uint8Array(bundle.byteLength);
  bytes.set(bundle);
  return new Blob([bytes]);
}
