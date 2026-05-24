import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SANDBOX_MEMORY_MB,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  parseSkillSource,
  SkillParseError,
} from '../src/format/parser.js';

const VALID_SOURCE = `---
name: documents
description: Generate DOCX/PPTX documents from sandbox-executed code.
version: 1.0.0
category: document
contextFilter:
  workspaceTypes: [ai-ideas, opportunity]
  roles: [editor, admin]
  requiresOnline: false
sandbox:
  surface: [files.create]
  timeoutMs: 20000
  memoryMb: 64
tools:
  - name: document_generate
    description: Render a DOCX from a TypeScript program executed in the sandbox.
    inputSchema:
      type: object
      required: [title, code]
      properties:
        title: { type: string }
        code: { type: string }
    outputSchema:
      type: object
      properties:
        artefactId: { type: string }
    outputRenderHint: download
    sideEffect: true
authzRequirements:
  permissions: [document.generate]
---

# documents

Sandbox-based DOCX/PPTX generator.

## When to use
Call \`document_generate\` to export a downloadable artefact.
`;

describe('parseSkillSource', () => {
  it('parses a valid SKILL.md and extracts metadata, tools, and body', () => {
    const parsed = parseSkillSource(VALID_SOURCE);

    expect(parsed.metadata.name).toBe('documents');
    expect(parsed.metadata.description).toContain('DOCX');
    expect(parsed.metadata.version).toBe('1.0.0');
    expect(parsed.metadata.category).toBe('document');
    expect(parsed.metadata.contextFilter?.roles).toEqual(['editor', 'admin']);
    expect(parsed.metadata.sandbox?.surface).toEqual(['files.create']);
    expect(parsed.metadata.sandbox?.timeoutMs).toBe(20_000);
    expect(parsed.metadata.sandbox?.memoryMb).toBe(64);
    expect(parsed.metadata.toolNames).toEqual(['document_generate']);
    expect(parsed.metadata.authzRequirements?.permissions).toEqual([
      'document.generate',
    ]);

    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0]!.outputRenderHint).toBe('download');
    expect(parsed.tools[0]!.sideEffect).toBe(true);

    expect(parsed.body.startsWith('# documents')).toBe(true);
    expect(parsed.body).toContain('## When to use');
  });

  it('applies default sandbox timeout and memory when omitted', () => {
    const source = `---
name: minimal-sandbox
description: Minimal skill with a sandbox block that omits limits.
version: 0.1.0
category: workflow
sandbox:
  surface: []
tools:
  - name: noop
    description: A no-op tool.
    inputSchema:
      type: object
---

# minimal-sandbox

Body.
`;

    const parsed = parseSkillSource(source);
    expect(parsed.metadata.sandbox?.timeoutMs).toBe(DEFAULT_SANDBOX_TIMEOUT_MS);
    expect(parsed.metadata.sandbox?.memoryMb).toBe(DEFAULT_SANDBOX_MEMORY_MB);
    expect(parsed.metadata.sandbox?.surface).toEqual([]);
  });

  it('omits sandbox in metadata when not declared', () => {
    const source = `---
name: web
description: Read-only web search and extraction skill.
version: 0.1.0
category: web
tools:
  - name: web_search
    description: Search the web for a query.
    inputSchema:
      type: object
      properties:
        query: { type: string }
      required: [query]
---

# web
Body.
`;

    const parsed = parseSkillSource(source);
    expect(parsed.metadata.sandbox).toBeUndefined();
    expect(parsed.metadata.contextFilter).toBeUndefined();
  });

  it('throws SkillParseError on malformed YAML frontmatter', () => {
    const source = `---
name: broken
description: : : :
version: 1.0.0
category: web
tools:
  - name: x
    description: x
    inputSchema:
      type: object
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(SkillParseError);
  });

  it('throws when frontmatter delimiters are absent', () => {
    const source = `# documents\n\nNo frontmatter at all.\n`;
    expect(() => parseSkillSource(source)).toThrow(/frontmatter/);
  });

  it('rejects missing required fields', () => {
    const source = `---
name: incomplete
version: 1.0.0
category: web
tools:
  - name: t
    description: t
    inputSchema:
      type: object
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(/description/);
  });

  it('rejects non-kebab-case skill names', () => {
    const source = `---
name: BadName
description: Skill with invalid name casing.
version: 1.0.0
category: web
tools:
  - name: t
    description: t
    inputSchema:
      type: object
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(/kebab-case/);
  });

  it('rejects non-semver version strings', () => {
    const source = `---
name: bad-semver
description: Skill with invalid version.
version: latest
category: web
tools:
  - name: t
    description: t
    inputSchema:
      type: object
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(/semver/);
  });

  it('rejects descriptions longer than 280 characters', () => {
    const longDescription = 'x'.repeat(281);
    const source = `---
name: too-long
description: ${longDescription}
version: 1.0.0
category: web
tools:
  - name: t
    description: t
    inputSchema:
      type: object
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(/280/);
  });

  it('rejects unknown frontmatter keys (strict mode)', () => {
    const source = `---
name: extra-key
description: Skill with an unknown top-level key.
version: 1.0.0
category: web
foo: bar
tools:
  - name: t
    description: t
    inputSchema:
      type: object
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(SkillParseError);
  });

  it('rejects duplicate tool names within a single skill', () => {
    const source = `---
name: dupes
description: Skill with two tools sharing a name.
version: 1.0.0
category: web
tools:
  - name: same
    description: first
    inputSchema:
      type: object
  - name: same
    description: second
    inputSchema:
      type: object
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(/duplicate tool name/);
  });

  it('requires outputSchema when outputRenderHint is not "text"', () => {
    const source = `---
name: needs-output-schema
description: Render hint without output schema must fail.
version: 1.0.0
category: web
tools:
  - name: t
    description: t
    inputSchema:
      type: object
    outputRenderHint: chart
---

body
`;

    expect(() => parseSkillSource(source)).toThrow(/outputSchema/);
  });
});
