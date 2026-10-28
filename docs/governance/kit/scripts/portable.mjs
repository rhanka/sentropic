export function assertPortable(html) {
  if (/(?:src|href)\s*=\s*["'](?:\.?\.?\/|\/)?assets\//i.test(html)
    || /\bimport\s*\(/.test(html)
    || /\b(?:from|import)\s*["'](?:\.?\.?\/|\/)/.test(html)
    || /url\(\s*["']?(?!data:)[^)]*\bassets\//i.test(html)) {
    throw new Error('Portable HTML still contains external dist asset references.');
  }
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
  if (/<(?:script|link|img|source|video|audio|iframe)\b[^>]*\b(?:src|href|poster)\s*=\s*["'](?!data:|#)[^"']+/i.test(markup)
    || /url\(\s*["']?(?!data:|#)[^\s"')][^)]*\)/i.test(markup)) {
    throw new Error('Portable HTML must be single-file with all resources inline.');
  }
  const policies = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .filter(([tag]) => /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag))
    .map(([tag]) => /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2] ?? '');
  if (!policies.some(policy => policy.split(';').some(directive => /^connect-src\s+'none'$/i.test(directive.trim())))) {
    throw new Error("Portable HTML requires CSP connect-src 'none'.");
  }
}

export function inlinePortable(html, readAsset) {
  html = html.replace(/<head\b[^>]*>/i, tag => `${tag}<meta http-equiv="Content-Security-Policy" content="connect-src 'none'">`);
  html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (_tag, href) => `<style data-portable-source="${href}">${readAsset(href).replaceAll('</style', '<\\/style')}</style>`);
  html = html.replace(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (_tag, src) => `<script type="module" data-portable-source="${src}">${readAsset(src).replaceAll('</script', '<\\/script')}</script>`);
  assertPortable(html);
  return html;
}
