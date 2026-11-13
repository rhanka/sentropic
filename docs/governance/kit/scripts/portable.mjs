import { tokenizer } from 'acorn';

export function assertPortable(html) {
  // Imported diagram-core carries source examples as strings. Inspect script
  // tokens so examples remain data while real chunk imports still fail closed.
  for (const [, code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const tokens = [...tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module' })];
    for (const [index, token] of tokens.entries()) {
      if (token.type.label === 'import' && tokens[index + 1]?.type.label !== '.'
        || token.type.label === 'export' && tokens.slice(index + 1).some(next => next.type.label === 'string' && /^(?:\.?\.?\/|\/)/.test(next.value))) {
        throw new Error('Portable HTML still contains external dist asset references.');
      }
    }
  }
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
  if (/(?:src|href)\s*=\s*["'](?:\.?\.?\/|\/)?assets\//i.test(markup)
    || /url\(\s*["']?(?!data:)[^)]*\bassets\//i.test(markup)) {
    throw new Error('Portable HTML still contains external dist asset references.');
  }
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
