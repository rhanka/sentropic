import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const wrapperPath = resolve(
  process.cwd(),
  'src/lib/components/StreamMessage.svelte',
);

const readWrapper = (): string => readFileSync(wrapperPath, 'utf8');

describe('StreamMessage app wrapper', () => {
  it('wraps the package component and injects the app streamHub', () => {
    const source = readWrapper();
    expect(source).toContain(
      "import PackageStreamMessage from '@sentropic/chat-ui/components/StreamMessage.svelte'",
    );
    expect(source).toContain("import { streamHub } from '$lib/stores/streamHub'");
    expect(source).toContain("import { _ } from 'svelte-i18n'");
    expect(source).toContain('streamClient={streamHub}');
    expect(source).toContain('labels={labelResolver}');
    expect(source).toContain('{smoothContentStreaming}');
    expect(source).toContain('{smoothChunkThreshold}');
    expect(source).toContain('{subscriptionMode}');
    expect(source).toContain('{finalContent}');
  });
});
