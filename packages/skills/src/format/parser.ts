import matter from 'gray-matter';
import { z } from 'zod';

import type { ContextFilter } from '../types/context-filter.js';
import type { SandboxPolicy, SandboxSurface } from '../types/sandbox-policy.js';
import type {
  JsonSchemaFragment,
  OutputRenderHint,
  SkillTool,
} from '../types/skill-tool.js';
import type { SkillAuthzRequirements, SkillMetadata } from '../types/metadata.js';

/**
 * Default sandbox limits applied when `SKILL.md` declares a sandbox without
 * explicit `timeoutMs` / `memoryMb` (per SPEC_EVOL_BR19 §1.1).
 */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 30_000;
export const DEFAULT_SANDBOX_MEMORY_MB = 128;
const MAX_DESCRIPTION_LENGTH = 280;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const KEBAB_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** Loose JSON Schema fragment validator: must be a plain non-null object. */
const jsonSchemaFragmentSchema: z.ZodType<JsonSchemaFragment> = z
  .record(z.unknown())
  .refine((value) => value !== null && typeof value === 'object', {
    message: 'inputSchema must be a JSON Schema object',
  });

const contextFilterSchema: z.ZodType<ContextFilter> = z
  .object({
    workspaceTypes: z.array(z.string().min(1)).optional(),
    roles: z.array(z.string().min(1)).optional(),
    requiresOnline: z.boolean().optional(),
  })
  .strict();

const sandboxSurfaceSchema: z.ZodType<SandboxSurface> = z.string().min(1) as z.ZodType<SandboxSurface>;

const sandboxPolicyInputSchema = z
  .object({
    surface: z.array(sandboxSurfaceSchema),
    timeoutMs: z.number().int().positive().optional(),
    memoryMb: z.number().int().positive().optional(),
  })
  .strict();

const outputRenderHintSchema: z.ZodType<OutputRenderHint> = z.string().min(1) as z.ZodType<OutputRenderHint>;

const skillToolSchema: z.ZodType<SkillTool> = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(KEBAB_PATTERN, 'tool name must be kebab-case'),
    description: z.string().min(1),
    inputSchema: jsonSchemaFragmentSchema,
    outputSchema: jsonSchemaFragmentSchema.optional(),
    outputRenderHint: outputRenderHintSchema.optional(),
    sideEffect: z.boolean().optional(),
    requiresApproval: z.boolean().optional(),
  })
  .strict()
  .refine(
    (tool) =>
      tool.outputRenderHint === undefined ||
      tool.outputRenderHint === 'text' ||
      tool.outputSchema !== undefined,
    {
      message: 'outputSchema is required when outputRenderHint is not "text"',
      path: ['outputSchema'],
    },
  );

const authzRequirementsSchema: z.ZodType<SkillAuthzRequirements> = z
  .object({
    permissions: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * Strict frontmatter shape accepted by the parser. Extra unknown keys are
 * rejected to keep `SKILL.md` evolution explicit.
 */
const frontmatterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(KEBAB_PATTERN, 'skill name must be kebab-case'),
    description: z
      .string()
      .min(1)
      .max(
        MAX_DESCRIPTION_LENGTH,
        `description must be ≤ ${MAX_DESCRIPTION_LENGTH} characters`,
      ),
    version: z
      .string()
      .regex(SEMVER_PATTERN, 'version must be semver (e.g. 1.0.0)'),
    category: z.string().min(1),
    contextFilter: contextFilterSchema.optional(),
    sandbox: sandboxPolicyInputSchema.optional(),
    tools: z.array(skillToolSchema).min(1, 'skill must declare at least one tool'),
    authzRequirements: authzRequirementsSchema.optional(),
  })
  .strict();

export type ParsedFrontmatter = z.infer<typeof frontmatterSchema>;

/**
 * Result of parsing a `SKILL.md` source: the validated metadata projection,
 * the tool descriptors, and the free-form Markdown body.
 */
export interface ParsedSkill {
  readonly metadata: SkillMetadata;
  readonly tools: ReadonlyArray<SkillTool>;
  readonly body: string;
}

/** Error raised when a `SKILL.md` source cannot be parsed or validated. */
export class SkillParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SkillParseError';
  }
}

const normalizeSandbox = (
  raw: ParsedFrontmatter['sandbox'] | undefined,
): SandboxPolicy | undefined => {
  if (!raw) return undefined;
  return {
    surface: raw.surface,
    timeoutMs: raw.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    memoryMb: raw.memoryMb ?? DEFAULT_SANDBOX_MEMORY_MB,
  };
};

const buildMetadata = (data: ParsedFrontmatter): SkillMetadata => ({
  name: data.name,
  description: data.description,
  version: data.version,
  category: data.category,
  contextFilter: data.contextFilter,
  sandbox: normalizeSandbox(data.sandbox),
  authzRequirements: data.authzRequirements,
  toolNames: data.tools.map((tool) => tool.name),
});

/**
 * Parse a `SKILL.md` source string into a `ParsedSkill`. Throws
 * `SkillParseError` on malformed YAML, schema violation, or duplicate tool
 * names. Always strict — unknown frontmatter keys are rejected.
 */
export function parseSkillSource(source: string): ParsedSkill {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(source);
  } catch (error) {
    throw new SkillParseError('SKILL.md frontmatter is not valid YAML', error);
  }

  if (!parsed.matter || parsed.matter.trim().length === 0) {
    throw new SkillParseError(
      'SKILL.md must declare a YAML frontmatter block delimited by ---',
    );
  }

  const validation = frontmatterSchema.safeParse(parsed.data);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new SkillParseError(`SKILL.md frontmatter is invalid — ${issues}`);
  }

  const data = validation.data;
  const seen = new Set<string>();
  for (const tool of data.tools) {
    if (seen.has(tool.name)) {
      throw new SkillParseError(
        `SKILL.md declares duplicate tool name "${tool.name}"`,
      );
    }
    seen.add(tool.name);
  }

  return {
    metadata: buildMetadata(data),
    tools: data.tools,
    body: parsed.content.trim(),
  };
}
