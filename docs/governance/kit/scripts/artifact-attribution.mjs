export function artifactAttribution() {
  return { name: 'artifact-attribution', generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter(item => item.type === 'chunk').map(chunk => ({
      path: chunk.fileName, entry: chunk.isEntry, dynamic: chunk.isDynamicEntry,
      imports: chunk.imports, dynamicImports: chunk.dynamicImports,
      modules: Object.entries(chunk.modules).map(([id, module]) => ({
        id: id.replaceAll('\\', '/').replace(/^.*\/(?:node_modules|src)\//, ''),
        category: /@sentropic\/design-system-svelte/.test(id) ? 'design-system'
          : /design-system-themes/.test(id) ? 'themes' : /node_modules\/svelte/.test(id) ? 'framework'
          : /architecture-routing|governance-collapse|layout/.test(id) ? 'routing'
          : /\.json$/.test(id) ? 'dossier-data' : 'app',
        renderedLength: module.renderedLength,
      })),
    }));
    this.emitFile({ type: 'asset', fileName: '.vite/module-attribution.json',
      source: JSON.stringify({ accounting: 'Rollup renderedLength before final minification; compressed module sizes are not additive', chunks }, null, 2) });
  } };
}
