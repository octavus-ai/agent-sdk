import { z } from 'zod';

const ApiErrorResponseSchema = z.looseObject({
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

/**
 * Error thrown when API request fails
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    /**
     * Any other fields of the error response, for errors that carry data to act
     * on (for example the `currentThreadId` of an `AGENT_BUSY` error).
     */
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ParsedApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Parse error from API response using Zod
 */
export async function parseApiError(
  response: Response,
  defaultMessage: string,
): Promise<ParsedApiError> {
  const fallbackMessage = `${defaultMessage}: ${response.statusText}`;

  try {
    const json: unknown = await response.json();
    const parsed = ApiErrorResponseSchema.safeParse(json);

    if (parsed.success) {
      const { error, message, code, ...details } = parsed.data;
      return {
        message: error ?? message ?? fallbackMessage,
        code,
        ...(Object.keys(details).length > 0 ? { details } : {}),
      };
    }
  } catch {
    // Use default message
  }

  return { message: fallbackMessage };
}

/**
 * Parse error from API response and throw ApiError
 */
export async function throwApiError(response: Response, defaultMessage: string): Promise<never> {
  const { message, code, details } = await parseApiError(response, defaultMessage);
  throw new ApiError(message, response.status, code, details);
}
