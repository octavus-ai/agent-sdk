import { z } from 'zod';
import { chatMessageSchema, uiMessageSchema } from '@octavus/core';

// ---------------------------------------------------------------------------
// Session schemas
// ---------------------------------------------------------------------------

export const createSessionResponseSchema = z.object({
  sessionId: z.string(),
});

export const sessionStateSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  input: z.record(z.string(), z.unknown()),
  variables: z.record(z.string(), z.unknown()),
  resources: z.record(z.string(), z.unknown()),
  messages: z.array(chatMessageSchema),
  status: z.literal('active').optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const uiSessionResponseSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  messages: z.array(uiMessageSchema),
  status: z.literal('active').optional(),
});

export const expiredSessionResponseSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.literal('expired'),
  createdAt: z.string(),
});

export const restoreSessionResponseSchema = z.object({
  sessionId: z.string(),
  restored: z.boolean(),
});

export const clearSessionResponseSchema = z.object({
  sessionId: z.string(),
  cleared: z.boolean(),
});

// ---------------------------------------------------------------------------
// Execution log schemas
// ---------------------------------------------------------------------------

/**
 * Validates the envelope and base fields of each entry without being strict
 * about per-type fields. This keeps the SDK forward-compatible when the server
 * adds new entry types - unknown types pass through instead of failing validation.
 * Consumers narrow on `entry.type` using the TypeScript discriminated union.
 */
const executionLogEntrySchema = z.looseObject({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
});

export const executionLogsResponseSchema = z.object({
  sessionId: z.string(),
  entries: z.array(executionLogEntrySchema),
  total: z.number().optional(),
  truncated: z.boolean().optional(),
});
