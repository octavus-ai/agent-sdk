/**
 * Internal Octavus tool definitions.
 *
 * These tools are reserved by Octavus and executed server-side.
 * User-defined tools and workers cannot use the "octavus_" prefix.
 */

/**
 * Prefix reserved for internal Octavus tools.
 * User-defined tools/workers cannot use this prefix.
 */
export const OCTAVUS_INTERNAL_PREFIX = 'octavus_';

/**
 * All internal Octavus tool names.
 *
 * These are tools that are executed server-side by the Octavus runtime.
 * They should never be sent to client handlers.
 */
export const OCTAVUS_INTERNAL_TOOLS = {
  // === Skill Tools (executed in E2B sandboxes) ===
  /** Read skill documentation (SKILL.md) */
  SKILL_READ: 'octavus_skill_read',
  /** List available scripts in a skill */
  SKILL_LIST: 'octavus_skill_list',
  /** Execute a pre-built skill script */
  SKILL_RUN: 'octavus_skill_run',
  /** Execute Python/Bash code in sandbox */
  CODE_RUN: 'octavus_code_run',
  /** Create/write files in sandbox */
  FILE_WRITE: 'octavus_file_write',
  /** Read files from sandbox */
  FILE_READ: 'octavus_file_read',

  // === Image Generation ===
  /** Generate images using AI models */
  GENERATE_IMAGE: 'octavus_generate_image',
} as const;

export type OctavusInternalToolName =
  (typeof OCTAVUS_INTERNAL_TOOLS)[keyof typeof OCTAVUS_INTERNAL_TOOLS];

/**
 * Check if a tool name is an internal Octavus tool.
 *
 * Internal tools are reserved by Octavus and executed server-side.
 * User-defined tools cannot start with "octavus_".
 *
 * @example
 * ```typescript
 * if (isOctavusInternalTool(toolName)) {
 *   // This is an internal Octavus tool, skip client handling
 * }
 * ```
 */
export function isOctavusInternalTool(toolName: string): boolean {
  return toolName.startsWith(OCTAVUS_INTERNAL_PREFIX);
}

/**
 * Skill tool names (subset of internal tools).
 *
 * Use this for skill-specific filtering. For checking if any tool is internal,
 * use `isOctavusInternalTool()` instead.
 */
export const OCTAVUS_SKILL_TOOLS = {
  SKILL_READ: OCTAVUS_INTERNAL_TOOLS.SKILL_READ,
  SKILL_LIST: OCTAVUS_INTERNAL_TOOLS.SKILL_LIST,
  SKILL_RUN: OCTAVUS_INTERNAL_TOOLS.SKILL_RUN,
  CODE_RUN: OCTAVUS_INTERNAL_TOOLS.CODE_RUN,
  FILE_WRITE: OCTAVUS_INTERNAL_TOOLS.FILE_WRITE,
  FILE_READ: OCTAVUS_INTERNAL_TOOLS.FILE_READ,
} as const;

export type OctavusSkillToolName = (typeof OCTAVUS_SKILL_TOOLS)[keyof typeof OCTAVUS_SKILL_TOOLS];

/**
 * Check if a tool name is an Octavus skill tool.
 *
 * Skill tools are a subset of internal tools that execute in E2B sandboxes.
 *
 * @example
 * ```typescript
 * if (isOctavusSkillTool(event.toolName)) {
 *   // This is a skill tool, executed in E2B sandbox
 *   const skillSlug = event.input?.skill;
 * }
 * ```
 */
export function isOctavusSkillTool(toolName: string): toolName is OctavusSkillToolName {
  return Object.values(OCTAVUS_SKILL_TOOLS).includes(toolName as OctavusSkillToolName);
}
