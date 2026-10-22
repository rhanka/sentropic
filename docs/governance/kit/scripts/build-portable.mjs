import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dossier, portableName } from './portable-path.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}/dist`;
const indexPath = `${dist}/index.html`;
const portablePath = `${dist}/${portableName}`;
const readAsset = (assetPath) => readFileSync(`${dist}/${assetPath.replace(/^\.?\//, '').replace(/^\//, '')}`, 'utf8');
const { title, summary } = dossier;
const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

let html = readFileSync(indexPath, 'utf8');
html = html.replace(
  /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (_tag, href) => `<style data-portable-source="${href}">${readAsset(href).replaceAll('</style', '<\\/style')}</style>`,
);
html = html.replace(
  /<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_tag, src) => `<script type="module" data-portable-source="${src}">${readAsset(src).replaceAll('</script', '<\\/script')}</script>`,
);

if (/(?:src|href)="\/?assets\//.test(html)) {
  throw new Error('Portable HTML still contains external dist asset references.');
}
// A blocked or truncated inline script must not leave an empty preview. Svelte
// removes this sibling only after the interactive dossier has mounted.
html = html.replace(/<div\b[^>]*id="app"[^>]*>/, `<section id="portable-fallback" aria-label="Aperçu du dossier" style="padding:var(--st-spacing-4,1rem);font-family:var(--st-font-sans,system-ui,sans-serif)">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(summary)}</p>
  <p role="status">Ouverture du dossier… Si cet aperçu reste affiché, ouvrir le fichier HTML téléchargé dans Chrome ou Firefox.</p>
</section>$&`);
writeFileSync(portablePath, html);
console.log(`Portable HTML: ${portablePath}`);
