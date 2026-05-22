import { createDocxHostBridge } from '../../../sandbox/docx-host-bridge.js';
import { createPptxHostBridge } from '../../../sandbox/pptx-host-bridge.js';
import type { SandboxRuntime } from '../../../sandbox/runtime.js';
import type { Skill, SkillToolHandler, SkillToolInvocation, SkillToolResult } from '../../../types/skill.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

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

const DEFERRED_SUFFIX = "is deferred to Wave D step 1.C; only freeform-DOCX (step 1.A) and freeform-PPTX (step 1.B) are bound";

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
    // Sub-path routing (freeform DOCX bound in step 1.A; freeform PPTX
    // bound in step 1.B; template DOCX deferred to BR19-D3 closing rebind).
    // The legacy `action=upskill` mode was removed in BR19-D6: the LLM now
    // discovers the helper API via `search_skills` + SKILL.md instead of a
    // tool-call indirection.
    // ------------------------------------------------------------------
    if (action !== 'generate') {
      throwDeferred(`action=${action || '<missing>'}`);
    }
    if (format !== 'docx' && format !== 'pptx') {
      throwDeferred(`action=generate&format=${format}`);
    }
    if (templateId) {
      // PPTX template renderers do not exist in legacy; this guard targets the
      // DOCX template renderers (`usecase-onepage` / `executive-synthesis-multipage`).
      throwDeferred(`action=generate&format=${format}&templateId=${templateId}`);
    }
    if (!code || typeof code !== 'string' || code.length === 0) {
      throwDeferred(`action=generate&format=${format}&(no-code-no-templateId)`);
    }

    // ------------------------------------------------------------------
    // Bound path: V8 sandbox + docx/pptx host bridge.
    // ------------------------------------------------------------------
    if (!isCallerWithDeps(invocation.caller)) {
      throw new Error(
        'document_generate: caller must provide { sandboxRuntime, filesAdapter }',
      );
    }
    const caller = invocation.caller;

    const isPptx = format === 'pptx';
    const docxBridge = isPptx ? undefined : createDocxHostBridge();
    const pptxBridge = isPptx ? createPptxHostBridge() : undefined;

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
      bridges: {
        ...(docxBridge ? { docx: docxBridge } : {}),
        ...(pptxBridge ? { pptx: pptxBridge } : {}),
      },
    });
    if (!result.ok) {
      docxBridge?.reset();
      pptxBridge?.reset();
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
      buffer = isPptx
        ? await pptxBridge!.packToBuffer(result.output as string)
        : await docxBridge!.packToBuffer(result.output as string);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: null,
        isError: true,
        errorMessage: `document_generate packToBuffer failure: ${message}`,
      };
    } finally {
      docxBridge?.reset();
      pptxBridge?.reset();
    }

    const titleSlug = slugify(input.title ?? caller.title ?? '') || 'document';
    const fileName = isPptx ? `${titleSlug}.pptx` : `${titleSlug}.docx`;
    const mimeType = isPptx ? PPTX_MIME : DOCX_MIME;
    const artefact = await caller.filesAdapter.create({
      name: fileName,
      mimeType,
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
