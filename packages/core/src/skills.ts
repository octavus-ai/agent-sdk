/**
 * Skill-specific utilities.
 *
 * For internal tool definitions and checking, see internal-tools.ts
 */

import { isOctavusSkillTool } from './internal-tools';

/**
 * Extract skill slug from skill tool arguments.
 *
 * Most skill tools include a `skill` parameter with the skill slug.
 * Returns undefined if the tool is not a skill tool or if the skill slug is not present.
 *
 * @example
 * ```typescript
 * const slug = getSkillSlugFromToolCall(event.toolName, event.input);
 * if (slug) {
 *   console.log(`Using skill: ${slug}`);
 * }
 * ```
 */
export function getSkillSlugFromToolCall(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string | undefined {
  if (!isOctavusSkillTool(toolName) || !args) {
    return undefined;
  }

  // Most skill tools have a 'skill' parameter
  if (typeof args.skill === 'string') {
    return args.skill;
  }

  return undefined;
}
