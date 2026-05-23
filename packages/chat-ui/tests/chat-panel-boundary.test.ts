import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelPath = resolve(process.cwd(), 'src/components/ChatPanel.svelte');

const readPanel = (): string => readFileSync(panelPath, 'utf8');

describe('ChatPanel package boundary', () => {
  it('exists as a package-owned chat panel shell', () => {
    expect(existsSync(panelPath)).toBe(true);
  });

  it('does not import app-owned stores, API clients, or app components', () => {
    const source = readPanel();
    expect(source).not.toContain('$lib/');
    expect(source).not.toContain("from 'svelte-i18n'");
    expect(source).not.toContain('apiGet');
    expect(source).not.toContain('apiPost');
    expect(source).not.toContain('EditableInput');
    expect(source).not.toContain('DocumentSourceMenu');
    expect(source).not.toContain('chrome.runtime');
    expect(source).not.toContain('__TOPAI_VSCODE_RUNTIME__');
  });

  it('exposes injected host, transport, context, renderer, and render surface props', () => {
    const source = readPanel();
    expect(source).toContain('export let host');
    expect(source).toContain('export let transport');
    expect(source).toContain('export let streamClient');
    expect(source).toContain('export let contextProvider');
    expect(source).toContain('export let rendererRegistry');
    expect(source).toContain('export let renderShell');
    expect(source).toContain('renderTimeline');
    expect(source).toContain('renderComposer');
  });
});
