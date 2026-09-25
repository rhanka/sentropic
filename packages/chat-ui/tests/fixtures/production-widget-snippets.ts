import { readFileSync } from 'node:fs';

// Compile production markup verbatim; missing/renamed snippets fail the harness.
// Only the surrounding host state and ChatPanel side effects are test doubles.
export function productionWidgetSnippets() {
  return {
    name: 'production-widget-snippets',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.endsWith('/ProductionWidgetHarness.svelte')) return;
      const source = readFileSync(new URL('../../../../ui/src/lib/components/ChatWidget.svelte', import.meta.url), 'utf8');
      for (const name of ['renderChatBodyHost', 'renderContentGateHost', 'renderAppDockContent']) {
        const start = source.indexOf(`{#snippet ${name}(`);
        const end = source.indexOf('{/snippet}', start);
        if (start < 0 || end < start) throw new Error(`Missing production snippet: ${name}`);
        code = code.replace(`<!-- production:${name} -->`, source.slice(start, end + '{/snippet}'.length));
      }
      return { code, map: null };
    },
  };
}
