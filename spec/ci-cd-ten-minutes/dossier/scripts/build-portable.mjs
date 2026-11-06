import fs from 'node:fs';
import path from 'node:path';
let html = fs.readFileSync('dist/index.html', 'utf8');
const asset = href => {
  const file = path.resolve('dist', href.replace(/^\.?\//, ''));
  if (!file.startsWith(path.resolve('dist') + path.sep)) throw Error('Asset escapes dist');
  return fs.readFileSync(file, 'utf8');
};
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (_, href) => `<style>${asset(href).replaceAll('</style', '<\\/style')}</style>`);
html = html.replace(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_, href) => `<script type="module">${asset(href).replaceAll('</script', '<\\/script')}</script>`);
if (/<(?:script|link)\b[^>]*(?:src|href)="(?:\.?\/)?assets\//.test(html)) throw Error('External build asset in portable output');
fs.writeFileSync('dist/ci-cd-sentropic-portable.html', html);
