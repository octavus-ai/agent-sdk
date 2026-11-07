import { z } from 'zod';
import { uiMessageSchema } from '@octavus/core';

// ---------------------------------------------------------------------------
// Session schemas
// ---------------------------------------------------------------------------

export const createSessionResponseSchema = z.looseObject({
  sessionId: z.string(),
});

/**
 * A session read: the session's metadata, whether its state is live or has
 * expired. Parsed loosely so the fields of an active session's body beyond its
 * metadata are left alone.
 */
export const sessionResponseSchema = z.looseObject({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string(),
  status: z.enum(['active', 'expired']).optional(),
  createdAt: z.string(),
});

export const uiSessionResponseSchema = z.looseObject({
  sessionId: z.string(),
  agentId: z.string(),
  messages: z.array(uiMessageSchema),
  status: z.literal('active').optional(),
});

export const expiredSessionResponseSchema = z.looseObject({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.literal('expired'),
  createdAt: z.string(),
});

export const restoreSessionResponseSchema = z.looseObject({
  sessionId: z.string(),
  restored: z.boolean(),
});

export const clearSessionResponseSchema = z.looseObject({
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

export const executionLogsResponseSchema = z.looseObject({
  sessionId: z.string(),
  entries: z.array(executionLogEntrySchema),
  total: z.number().optional(),
  truncated: z.boolean().optional(),
});
