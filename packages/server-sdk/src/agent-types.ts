import { z } from 'zod';
import type { OctavusError } from '@octavus/core';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const agentFormatSchema = z.enum(['interactive', 'worker']);

const agentPromptSchema = z.looseObject({
  name: z.string(),
  content: z.string(),
});

const agentReferenceSchema = z.looseObject({
  name: z.string(),
  title: z.string().optional(),
  description: z.string(),
  content: z.string(),
});

export const agentSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  format: agentFormatSchema,
  projectId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const agentsResponseSchema = z.looseObject({
  agents: z.array(agentSchema),
});

export const agentDefinitionSchema = agentSchema.extend({
  protocol: z.string(),
  prompts: z.array(agentPromptSchema),
  references: z.array(agentReferenceSchema),
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

/** Agent prompt */
export interface AgentPrompt {
  name: string;
  content: string;
}

/** A reference document the agent loads on demand. */
export interface AgentReference {
  name: string;
  /** The label of the reference's read card (the file's frontmatter `title`); never shown to the model. */
  title?: string;
  /** What the reference contains, listed in the agent's system prompt. */
  description: string;
  content: string;
}

/** An agent as the list returns it: the agent without its definition. */
export interface Agent {
  /** Agent ID - use this for API calls */
  id: string;
  /** Agent slug (human-readable identifier within project) */
  slug: string;
  name: string;
  description: string | null;
  format: AgentFormat;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

/** An agent as get, create, update, and archive return it: the agent with its definition. */
export interface AgentDefinition extends Agent {
  protocol: string;
  prompts: AgentPrompt[];
  references: AgentReference[];
}

/** A whole agent definition, as `create()` and `validate()` take it. */
export interface AgentDefinitionInput {
  slug: string;
  name: string;
  description?: string;
  format: AgentFormat;
  protocol: string;
  prompts: AgentPrompt[];
  references?: AgentReference[];
}

/**
 * A partial update of an agent: what is left out keeps its current value, and
 * `description: null` clears it. The slug is the agent's identity and is not
 * updated here.
 */
export interface AgentUpdateInput {
  name?: string;
  description?: string | null;
  format?: AgentFormat;
  protocol?: string;
  prompts?: AgentPrompt[];
  references?: AgentReference[];
}

/** One diagnostic of a validated definition, at its severity. */
export interface ValidationIssue {
  message: string;
  path?: string;
  severity: 'error' | 'warning' | 'info';
  /** The stable diagnostic code (`UNDEFINED_SKILL`, `MODEL_NOT_SUPPORTED`, `MISSING_DISPLAY_TITLE`, ...). */
  code?: string;
  suggestions?: string[];
}

/** The result of validating a definition: valid when no issue is an error. */
export interface AgentValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * The validation issues a failed request carried: those of a definition the
 * platform refused (`422` with the code `INVALID_PROTOCOL`, from `create()`
 * and `update()`), each at its severity. Issues of another shape, such as a
 * malformed request's, are left out.
 */
export function validationIssuesOf(error: OctavusError): ValidationIssue[] {
  return (error.issues ?? []).flatMap((issue) => {
    const parsed = validationIssueSchema.safeParse(issue);
    return parsed.success ? [parsed.data] : [];
  });
}
