import { z } from 'zod';
import { BaseApiClient } from '@/base-api-client.js';

// =============================================================================
// Schemas
// =============================================================================

/**
 * Schema for a mint request. `agentId` is required (ephemeral tokens are always
 * agent-bound); `sessionId` narrows to a single session (the tightest scope);
 * `ttlSeconds` requests a lifetime, clamped server-side to a maximum.
 */
export const mintTokenRequestSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  ttlSeconds: z.number().int().positive().optional(),
});

export const mintTokenResponseSchema = z.object({
  /** The scoped, short-lived bearer token (an `oct_et_*` string). */
  token: z.string(),
  /** Unique token id, usable to revoke it early. */
  jti: z.string(),
  /** ISO-8601 expiry. */
  expiresAt: z.string(),
});

// =============================================================================
// Types
// =============================================================================

export type MintTokenRequest = z.infer<typeof mintTokenRequestSchema>;
export type MintTokenResponse = z.infer<typeof mintTokenResponseSchema>;

// =============================================================================
// API
// =============================================================================

/**
 * API for minting short-lived, scoped ephemeral credentials.
 *
 * Trade a trusted long-lived key (with the "Mint Ephemeral Tokens" permission)
 * for a session-use token bound to one agent - and optionally one session - to
 * hand to ephemeral or user-reachable compute. The token expires on its own and
 * can only act within its scope, so it never needs to hold the long-lived key.
 *
 * @example
 * ```typescript
 * const control = new OctavusClient({ baseUrl, apiKey: process.env.OCTAVUS_API_KEY });
 * const { token, expiresAt } = await control.tokens.mint({ agentId, sessionId, ttlSeconds: 3600 });
 *
 * // Hand `token` to the runner; it can drive only that session, and only until `expiresAt`.
 * const runner = new OctavusClient({ baseUrl, apiKey: token });
 * ```
 */
export class TokensApi extends BaseApiClient {
  /**
   * Mint a scoped ephemeral token. The requested scope must be within the
   * calling key's scope, and the TTL is clamped to the platform maximum.
   *
   * @throws ApiError if the key lacks the mint permission, or the agent/session
   * is unknown or out of scope.
   */
  async mint(params: MintTokenRequest): Promise<MintTokenResponse> {
    return await this.httpPost('/api/tokens', params, mintTokenResponseSchema);
  }

  /**
   * Revoke a previously minted token before it expires. Idempotent - revoking an
   * unknown or already-expired token resolves with `revoked: false`.
   */
  async revoke(token: string): Promise<{ revoked: boolean; jti?: string }> {
    return await this.httpPost(
      '/api/tokens/revoke',
      { token },
      z.object({ revoked: z.boolean(), jti: z.string().optional() }),
    );
  }
}
