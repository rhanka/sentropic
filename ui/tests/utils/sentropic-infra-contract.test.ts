import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(__dirname, '..', '..', '..');

const readRootFile = (relativePath: string): string =>
  readFileSync(resolve(workspaceRoot, relativePath), 'utf8');

describe('Sentropic infra identity', () => {
  it('uses Sentropic source image names in make, compose, and CI config', () => {
    const sources = [
      'Makefile',
      'docker-compose.yml',
      'docker-compose.dev.yml',
      'docker-compose.test.yml',
      'docker-compose.e2e-vscode.yml',
      '.github/workflows/ci.yml',
    ].map((path) => [path, readRootFile(path)] as const);

    for (const [path, source] of sources) {
      expect(source, path).not.toContain('top-ai-ideas-api');
      expect(source, path).not.toContain('top-ai-ideas-ui');
      expect(source, path).not.toContain('top-ai-ideas-e2e');
      expect(source, path).not.toContain('top-ai-ideas-vscode-extension.vsix');
      expect(source, path).not.toContain('top-ai-ideas-fullstack-e2e');
      expect(source, path).not.toContain('top-ai-ideas-dev');
      expect(source, path).not.toContain('top-ai-ideas-test');
      expect(source, path).not.toContain('top-ai-ideas-fullstack_pg_data');
    }

    const makefile = readRootFile('Makefile');
    expect(makefile).toContain('export API_IMAGE_NAME ?= sentropic-api');
    expect(makefile).toContain('export UI_IMAGE_NAME  ?= sentropic-ui');
    expect(makefile).toContain('export E2E_IMAGE_NAME ?= sentropic-e2e');
    expect(makefile).toContain('DOC_BUCKET ?= $(or $(DOC_STORAGE_BUCKET),sentropic-docs-dev)');
    expect(makefile).toMatch(/typecheck-api:\s+prepare-node-workspace/);
    expect(makefile).toMatch(
      /typecheck-api:[\s\S]*docker-compose\.yml -f docker-compose\.dev\.yml run --rm --no-deps api npm run typecheck/,
    );

    const ci = readRootFile('.github/workflows/ci.yml');
    expect(ci).not.toContain('SOURCE_UI_IMAGE_NAME');
    expect(ci).not.toContain('SOURCE_API_IMAGE_NAME');
    expect(ci).toContain('VITE_API_BASE_URL: https://sentropic.sent-tech.ca/api/v1');

    expect(readRootFile('docker-compose.dev.yml')).toContain(
      'DOC_STORAGE_BUCKET=${DOC_STORAGE_BUCKET:-sentropic-docs-dev}',
    );
    expect(readRootFile('docker-compose.test.yml')).toContain(
      'DOC_STORAGE_BUCKET=${DOC_STORAGE_BUCKET:-sentropic-docs-test}',
    );
  });

  it('keeps deployed k8s images on canonical Sentropic names', () => {
    expect(readRootFile('deploy/k8s/30-api.yaml')).toContain(
      'rg.fr-par.scw.cloud/nc-reg/sentropic-api:main',
    );
    expect(readRootFile('deploy/k8s/40-ui.yaml')).toContain(
      'rg.fr-par.scw.cloud/nc-reg/sentropic-ui:main',
    );
  });
});
