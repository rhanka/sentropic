export function assertPortable(html) {
  if (/(?:src|href)\s*=\s*["'](?:\.?\.?\/|\/)?assets\//i.test(html)
    || /\bimport\s*\(/.test(html)
    || /\b(?:from|import)\s*["'](?:\.?\.?\/|\/)/.test(html)
    || /url\(\s*["']?(?!data:)[^)]*\bassets\//i.test(html)) {
    throw new Error('Portable HTML still contains external dist asset references.');
  }
}

export function inlinePortable(html, readAsset) {
  html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (_tag, href) => `<style data-portable-source="${href}">${readAsset(href).replaceAll('</style', '<\\/style')}</style>`);
  html = html.replace(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (_tag, src) => `<script type="module" data-portable-source="${src}">${readAsset(src).replaceAll('</script', '<\\/script')}</script>`);
  assertPortable(html);
  return html;
}
