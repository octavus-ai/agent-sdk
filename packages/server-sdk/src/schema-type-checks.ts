/**
 * The public types below are written out by hand so the published types never
 * depend on zod, and each one must equal what its schema parses to. Nothing
 * imports this file: `tsc --noEmit` checks it, so a type and a schema that
 * drift apart fail the type check.
 */

import type { Wire } from '@octavus/core';
import type { z } from 'zod';
import type { AgentFormat, agentFormatSchema } from '@/agent-types.js';
import type {
  FileUploadInfo,
  UploadUrlsResponse,
  fileUploadInfoSchema,
  uploadUrlsResponseSchema,
} from '@/files.js';
import type { SessionStatus, sessionStatusSchema } from '@/sessions.js';
import type { SkillVisibility, skillVisibilitySchema } from '@/skills.js';
import type { MintTokenResponse, mintTokenResponseSchema } from '@/tokens.js';

/**
 * Exact type identity: optionality, `readonly`, and `any` all count. Write
 * both sides as flat object types; an intersection and the equivalent flat
 * type are not equal here.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- type identity is decided by comparing these two generic function types */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;
type WireOf<S extends z.ZodType> = Wire<z.output<S>>;

export type SchemaTypeChecks = [
  Expect<Equal<AgentFormat, WireOf<typeof agentFormatSchema>>>,
  Expect<Equal<SessionStatus, WireOf<typeof sessionStatusSchema>>>,
  Expect<Equal<SkillVisibility, WireOf<typeof skillVisibilitySchema>>>,
  Expect<Equal<FileUploadInfo, WireOf<typeof fileUploadInfoSchema>>>,
  Expect<Equal<UploadUrlsResponse, WireOf<typeof uploadUrlsResponseSchema>>>,
  Expect<Equal<MintTokenResponse, WireOf<typeof mintTokenResponseSchema>>>,
];
