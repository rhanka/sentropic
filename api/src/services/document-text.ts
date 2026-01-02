/**
 * Text extraction helpers for document summarization.
 * MVP requirement: support pdf, docx, pptx, md.
 */
type ExtractedDocumentMetadata = {
  title?: string;
  author?: string;
  lastModifiedBy?: string;
  created?: string;
  modified?: string;
  description?: string;
  subject?: string;
  pages?: number;
};

export type ExtractedDocumentInfo = {
  text: string;
  metadata: ExtractedDocumentMetadata;
  headingsH1: string[]; // best-effort, empty if not available
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coerceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function coerceNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function coerceDateIso(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return undefined;
}

function extractHeadingsH1FromAst(ast: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown) => {
    if (!isRecord(node)) return;
    const type = node.type;
    const text = node.text;
    const children = node.children;
    const metadata = node.metadata;

    if (type === 'heading' && typeof text === 'string' && isRecord(metadata)) {
      const level = metadata.level;
      if (level === 1) {
        const t = text.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
    }

    if (Array.isArray(children)) {
      for (const c of children) walk(c);
    }
  };

  if (isRecord(ast) && Array.isArray(ast.content)) {
    for (const top of ast.content) walk(top);
  }

  return out;
}

export async function extractDocumentInfoFromDocument(params: {
  bytes: Uint8Array;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<ExtractedDocumentInfo> {
  const mime = (params.mimeType || '').toLowerCase();
  const name = (params.filename || '').toLowerCase();

  const isMarkdown = mime === 'text/markdown' || name.endsWith('.md') || name.endsWith('.markdown');
  const isTextLike = mime.startsWith('text/') || mime.includes('json') || isMarkdown;

  if (isTextLike) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(params.bytes);
    return { text, metadata: {}, headingsH1: [] };
  }

  // Office / PDF via officeparser@6
  // NOTE: officeparser has a brittle CLI detection that assumes process.argv[1] exists in some environments.
  if (!process.argv[1]) process.argv[1] = 'app';

  const mod = (await import('officeparser')) as unknown as {
    parseOffice: (file: unknown, config?: Record<string, unknown>) => Promise<unknown>;
  };

  const buf = Buffer.from(params.bytes);
  const ast = await mod.parseOffice(buf, { outputErrorToConsole: false });

  // v6 returns an AST with a toText() helper.
  const maybeAst = ast as { toText?: () => string } | null;
  const text = maybeAst && typeof maybeAst.toText === 'function' ? maybeAst.toText() : '';

  // Metadata: best-effort mapping from officeparser OfficeMetadata -> plain JSON (dates to ISO).
  const metadata: ExtractedDocumentMetadata = {};
  if (isRecord(ast) && isRecord(ast.metadata)) {
    const m = ast.metadata;
    metadata.title = coerceString(m.title);
    metadata.author = coerceString(m.author);
    metadata.lastModifiedBy = coerceString(m.lastModifiedBy);
    metadata.description = coerceString(m.description);
    metadata.subject = coerceString(m.subject);
    metadata.pages = coerceNumber(m.pages);
    metadata.created = coerceDateIso(m.created);
    metadata.modified = coerceDateIso(m.modified);
  }

  const headingsH1 = extractHeadingsH1FromAst(ast);

  if (text) return { text, metadata, headingsH1 };

  // Fallbacks
  if (typeof ast === 'string') return { text: ast, metadata, headingsH1 };
  try {
    return { text: JSON.stringify(ast), metadata, headingsH1 };
  } catch {
    return { text: String(ast ?? ''), metadata, headingsH1 };
  }
}

// Back-compat helper: older call sites expect just text.
export async function extractTextFromDocument(params: {
  bytes: Uint8Array;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<string> {
  const { text } = await extractDocumentInfoFromDocument(params);
  return text;
}


