<script lang="ts">
  // BR-39e Lot 6 (D17) — DS-neutral provider glyphs (v1). Marks are monochrome
  // and inherit `currentColor` so they respect the host DS ThemeProvider. Final
  // brand-mark styling (Google/Apple have brand guidelines requiring their
  // official multi-colour marks + clear-space) is a DS-owner follow-up; this v1
  // ships recognizable neutral glyphs so the feature is usable without blocking
  // on brand assets. Unknown ids fall back to the provider's first letter.
  import { resolveFederationGlyphId } from '../federation.js';

  interface Props {
    /** Provider id (e.g. 'google'); selects the built-in mark. */
    id: string;
    /** Provider label; drives the text fallback + accessible title. */
    label?: string;
    /** Rendered glyph size in pixels. */
    size?: number;
  }

  let { id, label = '', size = 18 }: Props = $props();

  const glyph = $derived(resolveFederationGlyphId(id));
  const fallbackChar = $derived((label || id || '?').trim().charAt(0).toUpperCase() || '?');
</script>

<span
  class="auth-ui-provider-glyph"
  style={`width:${size}px;height:${size}px`}
  aria-hidden="true"
  data-provider={glyph}
>
  {#if glyph === 'google'}
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="presentation">
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.5-1.62 4.4-5.35 4.4a5.48 5.48 0 0 1 0-10.96c1.56 0 2.6.66 3.2 1.23l2.18-2.1A8.4 8.4 0 0 0 12 3.6a8.4 8.4 0 1 0 0 16.8c4.85 0 8.05-3.4 8.05-8.2 0-.55-.06-.96-.15-1.4Z" />
    </svg>
  {:else if glyph === 'github'}
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="presentation">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  {:else if glyph === 'microsoft'}
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="presentation">
      <path d="M3 3h8.5v8.5H3V3Zm9.5 0H21v8.5h-8.5V3ZM3 12.5h8.5V21H3v-8.5Zm9.5 0H21V21h-8.5v-8.5Z" />
    </svg>
  {:else if glyph === 'apple'}
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="presentation">
      <path d="M16.36 12.66c-.02-2.06 1.68-3.05 1.76-3.1-.96-1.4-2.45-1.6-2.98-1.62-1.27-.13-2.48.75-3.12.75-.64 0-1.64-.73-2.7-.71-1.39.02-2.67.8-3.38 2.04-1.44 2.5-.37 6.2 1.03 8.23.69.99 1.5 2.1 2.57 2.06 1.03-.04 1.42-.66 2.66-.66 1.24 0 1.59.66 2.68.64 1.11-.02 1.81-1 2.49-2 .78-1.15 1.11-2.26 1.13-2.32-.02-.01-2.17-.83-2.19-3.3ZM14.3 6.24c.57-.69.95-1.65.85-2.6-.82.03-1.8.54-2.39 1.23-.53.61-.99 1.59-.86 2.52.9.07 1.83-.46 2.4-1.15Z" />
    </svg>
  {:else if glyph === 'facebook'}
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="presentation">
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z" />
    </svg>
  {:else}
    <span class="auth-ui-provider-glyph__text">{fallbackChar}</span>
  {/if}
</span>

<style>
  .auth-ui-provider-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    line-height: 1;
  }
  .auth-ui-provider-glyph__text {
    font-size: 0.85em;
    font-weight: 700;
  }
</style>
