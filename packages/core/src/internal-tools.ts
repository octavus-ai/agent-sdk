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

  // === Reference Tools (agent-local documents fetched on demand) ===
  /** List all available references with descriptions */
  REFERENCE_LIST: 'octavus_reference_list',
  /** Read the full content of a specific reference */
  REFERENCE_READ: 'octavus_reference_read',

  // === MCP Management Tools (dynamic remote MCP activation) ===
  /** List available remote MCP integrations and their activation status */
  MCP_LIST: 'octavus_mcp_list',
  /** Activate a remote MCP integration, loading its tools for the current execution */
  MCP_ACTIVATE: 'octavus_mcp_activate',

  // === Image Generation ===
  /** Generate images using AI models */
  GENERATE_IMAGE: 'octavus_generate_image',

  // === Web Search ===
  /** Search the web for current information */
  WEB_SEARCH: 'octavus_web_search',
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

/**
 * MCP management tool names (subset of internal tools).
 *
 * MCP tools let agents discover and activate remote MCP integrations
 * at runtime, enabling dynamic tool loading without upfront connection.
 */
export const OCTAVUS_MCP_TOOLS = {
  MCP_LIST: OCTAVUS_INTERNAL_TOOLS.MCP_LIST,
  MCP_ACTIVATE: OCTAVUS_INTERNAL_TOOLS.MCP_ACTIVATE,
} as const;

export type OctavusMcpToolName = (typeof OCTAVUS_MCP_TOOLS)[keyof typeof OCTAVUS_MCP_TOOLS];

/**
 * Check if a tool name is an Octavus MCP management tool.
 *
 * MCP tools are a subset of internal tools that manage runtime activation
 * of remote MCP integrations.
 */
export function isOctavusMcpTool(toolName: string): toolName is OctavusMcpToolName {
  return Object.values(OCTAVUS_MCP_TOOLS).includes(toolName as OctavusMcpToolName);
}

/**
 * Reference tool names (subset of internal tools).
 *
 * Reference tools let agents dynamically fetch agent-local documents
 * without loading everything into the system prompt upfront.
 */
export const OCTAVUS_REFERENCE_TOOLS = {
  REFERENCE_LIST: OCTAVUS_INTERNAL_TOOLS.REFERENCE_LIST,
  REFERENCE_READ: OCTAVUS_INTERNAL_TOOLS.REFERENCE_READ,
} as const;

export type OctavusReferenceToolName =
  (typeof OCTAVUS_REFERENCE_TOOLS)[keyof typeof OCTAVUS_REFERENCE_TOOLS];

/**
 * Check if a tool name is an Octavus reference tool.
 */
export function isOctavusReferenceTool(toolName: string): toolName is OctavusReferenceToolName {
  return Object.values(OCTAVUS_REFERENCE_TOOLS).includes(toolName as OctavusReferenceToolName);
}
