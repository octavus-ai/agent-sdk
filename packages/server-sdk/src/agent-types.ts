import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const agentFormatSchema = z.enum(['interactive', 'worker']);

const agentSettingsSchema = z.looseObject({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  format: agentFormatSchema,
});

const agentPromptSchema = z.looseObject({
  name: z.string(),
  content: z.string(),
});

const agentReferenceSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  content: z.string(),
});

export const agentSchema = z.looseObject({
  slug: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  format: agentFormatSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  projectId: z.string(),
});

export const agentsResponseSchema = z.looseObject({
  agents: z.array(agentSchema),
});

export const agentDefinitionSchema = z.looseObject({
  settings: agentSettingsSchema,
  protocol: z.string(),
  prompts: z.array(agentPromptSchema),
  references: z.array(agentReferenceSchema),
  id: z.string(),
});

export const validationIssueSchema = z.looseObject({
  message: z.string(),
  path: z.string().optional(),
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
});

export const agentValidationResultSchema = z.looseObject({
  valid: z.boolean(),
  issues: z.array(validationIssueSchema),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Agent format - interactive (chat) or worker (background task) */
export type AgentFormat = z.infer<typeof agentFormatSchema>;

/** Agent settings */
export interface AgentSettings {
  slug: string;
  name: string;
  description?: string;
  format: AgentFormat;
}

/** Agent prompt */
export interface AgentPrompt {
  name: string;
  content: string;
}

/** A reference document the agent loads on demand. */
export interface AgentReference {
  name: string;
  description: string;
  content: string;
}

/** Agent summary returned from the list endpoint */
export interface Agent {
  /** Agent slug (human-readable identifier within project) */
  slug: string;
  /** Agent ID - use this for API calls */
  id: string;
  name: string;
  description: string | null;
  format: AgentFormat;
  createdAt: string;
  updatedAt: string;
  projectId: string;
}

/** Full agent definition returned from the get, create, update, and archive endpoints */
export interface AgentDefinition {
  settings: AgentSettings;
  protocol: string;
  prompts: AgentPrompt[];
  references: AgentReference[];
  /** Agent ID - use this for API calls like createSession */
  id: string;
}

/** A whole agent definition, as `create()` and `validate()` take it. */
export interface AgentDefinitionInput {
  settings: AgentSettings;
  protocol: string;
  prompts: AgentPrompt[];
  references?: AgentReference[];
}

/**
 * A partial update of an agent: what is left out keeps its current value. The
 * slug is the agent's identity and is not updated here.
 */
export interface AgentUpdateInput {
  settings?: {
    name: string;
    description?: string | null;
    format: AgentFormat;
  };
  protocol?: string;
  prompts?: AgentPrompt[];
  references?: AgentReference[];
}

/** One diagnostic of a validated definition, at its severity. */
export interface ValidationIssue {
  message: string;
  path?: string;
  severity: 'error' | 'warning' | 'info';
  /** The stable diagnostic code (`DISPLAY_MODE_REMOVED`, `UNDEFINED_SKILL`, ...). */
  code?: string;
  suggestions?: string[];
}

/** The result of validating a definition: valid when no issue is an error. */
export interface AgentValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
