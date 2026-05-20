import { createDocxHostBridge } from '../../../sandbox/docx-host-bridge.js';
import type { SandboxRuntime } from '../../../sandbox/runtime.js';
import type { Skill, SkillToolHandler, SkillToolInvocation, SkillToolResult } from '../../../types/skill.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Skill name advertised by `document_generate.SKILL.md`. Single tool, same
 * name as the skill itself.
 */
export const documentGenerateToolName = 'document_generate';

/**
 * Deferred-error message format. Sub-paths that are not yet bound throw this
 * shape so the chat-service dispatcher (and tests) can detect them
 * deterministically.
 */
const DEFERRED_PREFIX = "document_generate sub-path";

const DEFERRED_SUFFIX = "is deferred to Wave D step 1.B/1.C; only freeform-DOCX is bound in step 1.A";

/**
 * Throw a deferred-sub-path error with a stable descriptor used by tests.
 */
function throwDeferred(descriptor: string): never {
  throw new Error(`${DEFERRED_PREFIX} '${descriptor}' ${DEFERRED_SUFFIX}`);
}

/**
 * Caller context expected by the bound `document_generate` handler. The
 * adapter layer (chat-service / `SkillsToolRegistry` invoker) injects the
 * runtime + files adapter at dispatch time so this skill stays free of
 * ambient global state.
 */
export interface DocumentGenerateCaller {
  readonly sandboxRuntime: SandboxRuntime;
  readonly filesAdapter: {
    create(input: {
      name: string;
      mimeType: string;
      content: Uint8Array | string;
    }): Promise<{ artefactId: string; mimeType: string }>;
  };
  /** Optional title; used as the file name when generating. */
  readonly title?: string;
}

/**
 * Loose input shape for the `document_generate` tool — mirrors the schema in
 * `SKILL.md` (and `documentGenerateTool` in `api/src/services/tools.ts`).
 */
export interface DocumentGenerateInput {
  readonly action?: string;
  readonly format?: string;
  readonly templateId?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly code?: string;
  readonly title?: string;
}

function isDocumentGenerateInput(value: unknown): value is DocumentGenerateInput {
  return value !== null && typeof value === 'object';
}

function isCallerWithDeps(value: unknown): value is DocumentGenerateCaller {
  return (
    value !== null &&
    typeof value === 'object' &&
    'sandboxRuntime' in (value as object) &&
    'filesAdapter' in (value as object)
  );
}

/**
 * Slug helper for file-name sanitisation — same algorithm as
 * `api/src/services/docx-generation.ts:slugify` so file names stay stable
 * during the Wave D step 1.A → BR19-D3 rebind.
 */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

/**
 * Build the `document_generate` handler. The `skill` parameter is the loaded
 * Skill bundle (used to forward `metadata.sandbox` to the runtime so the
 * effective policy is the one declared in SKILL.md).
 */
export function createDocumentGenerateHandler(skill: Skill): SkillToolHandler {
  return async function documentGenerateHandler(
    invocation: SkillToolInvocation,
  ): Promise<SkillToolResult> {
    if (invocation.toolName !== documentGenerateToolName) {
      throw new Error(
        `document_generate handler invoked with unexpected tool name "${invocation.toolName}"`,
      );
    }
    if (!isDocumentGenerateInput(invocation.input)) {
      throw new TypeError('document_generate: input must be an object');
    }
    const input = invocation.input;
    const action = input.action ?? '';
    const format = input.format ?? 'docx';
    const code = input.code;
    const templateId = input.templateId;

    // ------------------------------------------------------------------
    // Sub-path routing (only freeform DOCX is bound in step 1.A).
    // ------------------------------------------------------------------
    if (action === 'upskill') {
      throwDeferred(`action=upskill&format=${format}`);
    }
    if (action !== 'generate') {
      throwDeferred(`action=${action || '<missing>'}`);
    }
    if (format === 'pptx') {
      throwDeferred('action=generate&format=pptx');
    }
    if (format !== 'docx') {
      throwDeferred(`action=generate&format=${format}`);
    }
    if (templateId) {
      throwDeferred(`action=generate&format=docx&templateId=${templateId}`);
    }
    if (!code || typeof code !== 'string' || code.length === 0) {
      throwDeferred('action=generate&format=docx&(no-code-no-templateId)');
    }

    // ------------------------------------------------------------------
    // Bound path: V8 sandbox + docx-host-bridge.
    // ------------------------------------------------------------------
    if (!isCallerWithDeps(invocation.caller)) {
      throw new Error(
        'document_generate: caller must provide { sandboxRuntime, filesAdapter }',
      );
    }
    const caller = invocation.caller;

    const bridge = createDocxHostBridge();
    // The user-supplied `code` is the sandbox entrypoint for this invocation.
    // We clone the skill so the runtime's `skill.sandboxEntry` check finds
    // the per-call code while keeping the bundle skill object immutable.
    const perCallSkill: Skill = {
      metadata: skill.metadata,
      tools: skill.tools,
      body: skill.body,
      handlers: skill.handlers,
      sandboxEntry: code,
    };
    const result = await caller.sandboxRuntime.execute(perCallSkill, {}, {
      bridges: { docx: bridge },
    });
    if (!result.ok) {
      return {
        output: null,
        isError: true,
        errorMessage:
          `document_generate sandbox failure (${result.errorCode ?? 'UNKNOWN'}): ` +
          (result.errorMessage ?? '<no message>'),
        metadata: { errorCode: result.errorCode, durationMs: result.durationMs },
      };
    }

    let buffer: Buffer;
    try {
      buffer = await bridge.packToBuffer(result.output as string);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: null,
        isError: true,
        errorMessage: `document_generate packToBuffer failure: ${message}`,
      };
    } finally {
      bridge.reset();
    }

    const titleSlug = slugify(input.title ?? caller.title ?? '') || 'document';
    const fileName = `${titleSlug}.docx`;
    const artefact = await caller.filesAdapter.create({
      name: fileName,
      mimeType: DOCX_MIME,
      content: new Uint8Array(buffer),
    });

    return {
      output: {
        artefactId: artefact.artefactId,
        mimeType: artefact.mimeType,
        fileName,
        byteLength: buffer.byteLength,
      },
      metadata: { durationMs: result.durationMs },
    };
  };
}

/**
 * Build a handler map for the skill bundle. The skill object is forwarded so
 * the runtime sees the SKILL.md sandbox policy (timeoutMs/memoryMb/surface).
 */
export function createDocumentGenerateHandlers(
  skill: Skill,
): Readonly<Record<string, SkillToolHandler>> {
  return Object.freeze({
    [documentGenerateToolName]: createDocumentGenerateHandler(skill),
  });
}
