/**
 * vitest-dep-svelte-ts.ts — preprocess DEPENDENCY `.svelte` files before
 * `@sveltejs/vite-plugin-svelte` compiles them (CHAT-AGENTS-BLK1).
 *
 * Why this exists
 * ---------------
 * `@sentropic/design-system-svelte` ships its `.svelte` files as TypeScript
 * SOURCE — that is its documented contract, and a Svelte-aware consumer is
 * expected to preprocess them. Our jsdom harness sets `svelte({ exclude: [] })`
 * so the plugin COMPILES dependency components, but it does not run `preprocess`
 * on files outside the project: adding `preprocess: vitePreprocess()` to its
 * options provably changes nothing here. Svelte therefore received raw
 * TypeScript and emitted a half-stripped script — annotations and the `lang="ts"`
 * marker gone, the optional-parameter `?` left behind:
 *
 *   RollupError: Parse failure: Expected ',', got '?'
 *   at ...design-system-svelte/dist/Accordion.svelte:50:29
 *
 * The published package was verified sound (sha256-identical to the DS lane's
 * own build, `lang="ts"` on line 1, full annotations on line 44). The gap was
 * ours, so the fix is ours.
 *
 * How
 * ---
 * Runs BEFORE the Svelte plugin (`enforce: 'pre'`) on dependency `.svelte` files
 * and hands them to Svelte's OWN `preprocess()` with `vitePreprocess()` — the
 * exact pair the plugin applies to project files.
 *
 * Two earlier attempts are recorded because each failed in an instructive way:
 *   1. Hand-rolled regex extraction of `<script lang="ts">` blocks + a raw
 *      esbuild transform. It broke on real files (`AppChrome.svelte:209:29
 *      Unexpected token`) — Svelte markup is not something to parse by regex.
 *   2. The same, with `verbatimModuleSyntax`. That fixed a nastier bug worth
 *      remembering — plain esbuild ELIDES imports it thinks are unused, and a
 *      Svelte component's template-only imports look unused because esbuild
 *      never sees the template, yielding `ReferenceError: Icon is not defined`
 *      at render time — but the regex fragility remained.
 * Using Svelte's own parser removes both classes of failure at once.
 *
 * Scope and limits, stated rather than discovered later
 * -----------------------------------------------------
 * - Test harness only: not part of the published package, never in an app build.
 * - Project files are untouched — they already go through `svelte.config.js`.
 * - The preprocessor's source map is not threaded back to Vite, so line numbers
 *   inside a dependency's script can shift in a stack trace. Acceptable for a
 *   jsdom harness; it would not be for shipped code.
 */
import { preprocess } from 'svelte/compiler';
import { transformWithEsbuild, type Plugin } from 'vite';

export const preprocessDependencySvelteTypeScript = (): Plugin => {
  // Svelte's own parser locates the script blocks; esbuild strips the types.
  // This is what vitePreprocess() does internally — reimplemented explicitly
  // because vitePreprocess() is a NO-OP outside the Vite plugin's context
  // (verified by instrumentation: the code came back byte-for-byte unchanged).
  // svelte-preprocess is NOT usable here either: its TypeScript transformer
  // rewrites Svelte 5 runes and breaks them —
  // "`$bindable()` can only be used inside a `$props()` declaration".
  const preprocessors = {
    name: 'chat-ui-dependency-typescript',
    async script({
      content,
      attributes,
      filename,
    }: {
      content: string;
      attributes: Record<string, string | boolean>;
      filename?: string;
    }) {
      if (attributes.lang !== 'ts') return undefined;
      const { code } = await transformWithEsbuild(content, `${filename ?? 'dep'}.ts`, {
        loader: 'ts',
        target: 'esnext',
        sourcemap: false,
        // LOAD-BEARING. esbuild elides imports it believes unused, and a Svelte
        // component's template-only imports look unused because esbuild never
        // sees the template. Without this, @lucide/svelte renders
        // `ReferenceError: Icon is not defined`.
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      });
      return { code };
    },
  };

  return {
    name: 'chat-ui:preprocess-dependency-svelte-ts',
    enforce: 'pre',

    async transform(code: string, id: string) {
      const file = id.split('?')[0];
      if (!file.endsWith('.svelte')) return null;
      if (!file.includes('node_modules')) return null;
      // Nothing to strip when no script declares TypeScript.
      if (!/\blang=["']ts["']/.test(code)) return null;

      const processed = await preprocess(code, preprocessors, { filename: file });
      return { code: processed.code, map: null };
    },
  };
};
