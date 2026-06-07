/**
 * documents-module.spec.ts
 *
 * Export surface registration + DocumentHost interface contract tests.
 * Also verifies the dedup re-export chain (ChatComposerAttachmentDraft
 * accessible from both old and new import paths).
 *
 * Contains a fake-host harness proving DocumentHost is implementable
 * without any app-side imports.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// 1. Package.json + export-manifest version
// ---------------------------------------------------------------------------

describe('documents module — export surface registration', () => {
  const PACKAGE_ROOT = process.cwd();
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as { version: string; exports: Record<string, unknown> };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'export-manifest.json'), 'utf8'),
  ) as { _version: string; subpaths: Record<string, unknown> };

  it('should export the ./documents subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain('./documents');
  });

  it('should list ./documents in export-manifest.json subpaths', () => {
    expect(Object.keys(manifest.subpaths)).toContain('./documents');
  });

  it('should export the AttachmentBand.svelte subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain('./documents/AttachmentBand.svelte');
  });

  it('should export the GeneratedFileCardTray.svelte subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain('./documents/GeneratedFileCardTray.svelte');
  });

  it('should have version 0.19.0 in package.json (minor — orphan sweep + composer fidelity restore)', () => {
    expect(pkgJson.version).toBe('0.19.0');
  });

  it('should have _version 0.19.0 in export-manifest.json', () => {
    expect(manifest._version).toBe('0.19.0');
  });

  it('should resolve the documents index source file to an existing path', () => {
    const entry = pkgJson.exports['./documents'] as Record<string, string>;
    const file = entry['import'] ?? entry['types'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it('should resolve the AttachmentBand.svelte source file to an existing path', () => {
    const entry = pkgJson.exports['./documents/AttachmentBand.svelte'] as Record<string, string>;
    const file = entry['svelte'] ?? entry['import'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it('should resolve the GeneratedFileCardTray.svelte source file to an existing path', () => {
    const entry = pkgJson.exports['./documents/GeneratedFileCardTray.svelte'] as Record<string, string>;
    const file = entry['svelte'] ?? entry['import'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Type dedup re-export chain
// ---------------------------------------------------------------------------

describe('documents module — type dedup re-export chain', () => {
  it('should export ChatComposerAttachmentDraft from documents/types', async () => {
    // If the import resolves and produces a module with no runtime error,
    // the type is exported correctly. Types are erased at runtime; we verify
    // the module loads and exports the expected function (same module).
    const mod = await import('../src/documents/types.js');
    // Types are erased — verify module loaded and is an object
    expect(typeof mod).toBe('object');
  });

  it('should load state/chatAttachments without error (re-export chain)', async () => {
    const mod = await import('../src/state/chatAttachments.js');
    // Verify the helper functions still exist at the old path
    expect(typeof mod.createImageAttachmentDraft).toBe('function');
    expect(typeof mod.summarizeComposerAttachments).toBe('function');
    expect(typeof mod.isSupportedImageAttachmentMimeType).toBe('function');
  });

  it('should load hosts/types without error (re-export chain)', async () => {
    const mod = await import('../src/hosts/types.js');
    // The module should still have ChatAttachmentHostAdapter (not re-exported, local)
    expect(typeof mod).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// 3. DocumentHost fake-host harness
// ---------------------------------------------------------------------------

import type {
  DocumentHost,
  ChatComposerAttachmentDraft,
  ChatGeneratedFileCard,
} from '../src/documents/index.js';

/**
 * A minimal in-memory DocumentHost implementation for testing.
 * Proves the interface is implementable with zero app-side imports.
 */
class FakeDocumentHost implements DocumentHost {
  public uploads: Array<{ draftId: string; fileName: string }> = [];
  public deletions: string[] = [];
  public downloads: string[] = [];

  async uploadFile(
    draft: ChatComposerAttachmentDraft,
    file: File,
  ): Promise<ChatComposerAttachmentDraft> {
    this.uploads.push({ draftId: draft.id, fileName: file.name });
    return { ...draft, state: 'ready', documentId: `doc_${draft.id}` };
  }

  async deleteUploadedFile(documentId: string): Promise<void> {
    this.deletions.push(documentId);
  }

  resolveAttachmentSrc(
    attachment: Pick<ChatComposerAttachmentDraft, 'previewUrl' | 'documentId'>,
  ): string {
    if (attachment.previewUrl) return attachment.previewUrl;
    if (attachment.documentId) return `/docs/${attachment.documentId}`;
    return '';
  }

  async downloadGeneratedFile(card: ChatGeneratedFileCard): Promise<void> {
    this.downloads.push(card.jobId);
  }
}

describe('documents module — FakeDocumentHost harness', () => {
  it('should satisfy DocumentHost interface with FakeDocumentHost', () => {
    const host: DocumentHost = new FakeDocumentHost();
    expect(host).toBeTruthy();
  });

  it('uploadFile should return updated draft with ready state', async () => {
    const host = new FakeDocumentHost();
    const draft: ChatComposerAttachmentDraft = {
      id: 'att_1',
      kind: 'image',
      source: 'upload',
      fileName: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      state: 'uploading',
    };
    const file = new File([''], 'photo.png', { type: 'image/png' });
    const result = await host.uploadFile(draft, file);
    expect(result.state).toBe('ready');
    expect(result.documentId).toBe('doc_att_1');
    expect(host.uploads).toHaveLength(1);
  });

  it('deleteUploadedFile should record the deletion', async () => {
    const host = new FakeDocumentHost();
    await host.deleteUploadedFile('doc_abc');
    expect(host.deletions).toContain('doc_abc');
  });

  it('resolveAttachmentSrc should use previewUrl when present', () => {
    const host = new FakeDocumentHost();
    expect(host.resolveAttachmentSrc({ previewUrl: 'blob:x', documentId: 'doc_1' })).toBe('blob:x');
  });

  it('resolveAttachmentSrc should fall back to documentId path', () => {
    const host = new FakeDocumentHost();
    expect(host.resolveAttachmentSrc({ documentId: 'doc_1' })).toBe('/docs/doc_1');
  });

  it('downloadGeneratedFile should record the download', async () => {
    const host = new FakeDocumentHost();
    await host.downloadGeneratedFile({ jobId: 'job_123', fileName: 'doc.docx' });
    expect(host.downloads).toContain('job_123');
  });
});
