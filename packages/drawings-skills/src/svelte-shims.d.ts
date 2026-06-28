// Let the lib's `tsc --noEmit` accept `.svelte` imports from .ts barrels.
// Real .svelte type-checking is done by the consuming app via svelte-check.
declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
}
