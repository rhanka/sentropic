/**
 * J1.3b — neutral host-parameterizable reader consent screen (generic grant
 * contract). No tenant strings: brand, title and support URL come from the
 * host declaration. The single prescribed navigation from a typed 403 is
 * `consentScreenPath(artifactId, scopeId, workspaceId)`; the screen posts once to the
 * sibling `grant` route (JSON or form), so a reader without consent reaches
 * it in one click with no loop.
 */

export interface ConsentScreenParams {
  brand: string;
  title: string;
  supportUrl?: string;
  artifactId: string;
  scopeId: string;
  scopeVersion: string;
  workspaceId: string;
}

/** Single prescribed navigation from the typed 403 `{ code, scopeId, retryable: false }`. */
export function consentScreenPath(artifactId: string, scopeId: string, workspaceId: string): string {
  return `reader-consents/screen?artifactId=${encodeURIComponent(artifactId)}&scopeId=${encodeURIComponent(scopeId)}&workspace_id=${encodeURIComponent(workspaceId)}`;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Neutral consent screen HTML; posts once to the sibling `grant` route. */
export function renderConsentScreen(params: ConsentScreenParams): string {
  const brand = esc(params.brand);
  const title = esc(params.title);
  const artifactId = esc(params.artifactId);
  const scopeId = esc(params.scopeId);
  const scopeVersion = esc(params.scopeVersion);
  const action = `grant?workspace_id=${encodeURIComponent(params.workspaceId)}`;
  const support = params.supportUrl === undefined ? '' :
    `<p><a href="${esc(params.supportUrl)}">Support</a></p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - ${brand}</title>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${brand} requests access to artifact <code>${artifactId}</code>.</p>
<dl>
<dt>Scope</dt><dd>${scopeId}</dd>
<dt>Version</dt><dd>${scopeVersion}</dd>
</dl>
<form method="post" action="${esc(action)}">
<input type="hidden" name="artifactId" value="${artifactId}">
<input type="hidden" name="scopeId" value="${scopeId}">
<input type="hidden" name="scopeVersion" value="${scopeVersion}">
<button type="submit">Allow access</button>
</form>
${support}
</main>
</body>
</html>`;
}
