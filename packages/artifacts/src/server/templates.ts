/**
 * L-5e — template kit + API guide catalog (spec-v8 §9 5e).
 *
 * The generic provider ships a minimal static-web kit and a versioned guide
 * describing the artifacts_* surface. Hosts inject their own catalog port
 * (approved template/guide assets); the default catalog carries no
 * credentials, no host data and no external URLs. A template kit contains
 * approved sources plus a build recipe — never executable server builds.
 */

export interface TemplateFile {
  path: string;
  content: string;
}

export interface ArtifactTemplate {
  templateId: string;
  version: string;
  description: string;
  files: TemplateFile[];
  buildRecipe: string[];
}

export interface ApiGuide {
  version: string;
  markdown: string;
}

export interface TemplateCatalogPort {
  getTemplate(templateId: string): Promise<ArtifactTemplate | undefined>;
  /** Omit the version for the catalog's current guide. */
  getApiGuide(version?: string): Promise<ApiGuide | undefined>;
}

export const DEFAULT_TEMPLATE_ID = 'static-html';
export const DEFAULT_API_GUIDE_VERSION = 'v1';

const INDEX_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Artifact page</title>',
  '<link rel="stylesheet" href="./styles.css">',
  '</head>',
  '<body>',
  '<main id="app">',
  '<h1>Artifact page</h1>',
  '<p>Static page published with the artifacts provider. Reader data calls',
  'go through the host reader profile; this kit performs none.</p>',
  '</main>',
  '<script src="./app.js"></script>',
  '</body>',
  '</html>',
  '',
].join('\n');

const STYLES_CSS = [
  'body { font-family: system-ui, sans-serif; margin: 2rem; }',
  'main { max-width: 44rem; }',
  '',
].join('\n');

const APP_JS = [
  "document.getElementById('app')?.setAttribute('data-ready', 'true');",
  '',
].join('\n');

const GUIDE_V1 = [
  '# Artifacts API guide v1',
  '',
  'Publish and share static web pages through the `artifacts_*` tools:',
  '',
  '- `artifacts_get_template` / `artifacts_get_api_guide`: start here.',
  '- `artifacts_ensure`: resolve (or create) your private artifact view;',
  '  optional `title`, `description` and `icon` (one short word) describe it.',
  '- `artifacts_publish`: publish inline `files` as a new release, or apply',
  '  small `edits` (`[{path, oldStr, newStr}]`) to the current release\'s',
  '  text files — `oldStr` must occur exactly once per file, otherwise the',
  '  call fails with `edit_mismatch` and changes nothing. Both accept',
  '  optional metadata and `expectedCurrentReleaseId`: when set and not the',
  '  current release, the call fails with a `conflict` error carrying the',
  '  current release id and digest so you can re-read and merge.',
  '  Strict profiles require this field on publish and revert; null means unpublished.',
  '  Edits target that observed release, with at most 100 ordered substitutions.',
  '  Reuse the exact idempotency key after a lost response, including commitState unknown.',
  '  Replays precede edits and CAS; changing metadata, edits or the precondition under',
  '  the same key returns conflict with variant command_conflict.',
  '  MCP returns the complete artifacts-outcome/v2 JSON envelope: ok, invocationId,',
  '  commitState, replayed/output on success, or typed error details on failure.',
  '- `artifacts_create_upload` + bounded HTTP append +',
  '  `artifacts_commit_upload`: stage large bytes, then commit them.',
  '- `artifacts_list` / `artifacts_get`: discover (metadata included).',
  '- `artifacts_list_versions`: full release history of one artifact —',
  '  per release: id, created at, author, state, whether it is current,',
  '  and a content digest.',
  '- `artifacts_get_source`: current file contents (text decoded) for editing.',
  '- `artifacts_revert`: make an earlier release current again as a NEW',
  '  release that copies its content — the artifact URL stays stable and',
  '  history only grows. Purged releases are refused with `release_unavailable`.',
  '- `artifacts_fork`: private independent copy (no ACL copied).',
  '- `artifacts_set_access`: grant/revoke read or source, toggle public.',
  '- `artifacts_promote`: explicit version selection (expected-current).',
  '- `artifacts_renew`, `artifacts_delete`, `artifacts_restore`: lifecycle.',
  '',
  'Rules: artifacts are private by default; "public" means approved',
  'accounts of the host, never anonymous. Source export is a separate',
  'right. Pages never receive credentials; reader data access goes through',
  'the host reader profile bound to the artifact and release.',
  '',
].join('\n');

/** Generic in-package catalog; hosts override with approved local assets. */
export function createDefaultTemplateCatalog(): TemplateCatalogPort {
  const template: ArtifactTemplate = {
    templateId: DEFAULT_TEMPLATE_ID,
    version: 'v1',
    description: 'Minimal static HTML page kit (no build step, no external calls).',
    files: [
      { path: 'index.html', content: INDEX_HTML },
      { path: 'styles.css', content: STYLES_CSS },
      { path: 'app.js', content: APP_JS },
    ],
    buildRecipe: ['Publish the files as-is with artifacts_publish; no build step.'],
  };
  const guide: ApiGuide = { version: DEFAULT_API_GUIDE_VERSION, markdown: GUIDE_V1 };
  return {
    getTemplate(templateId: string): Promise<ArtifactTemplate | undefined> {
      return Promise.resolve(templateId === template.templateId ? template : undefined);
    },
    getApiGuide(version?: string): Promise<ApiGuide | undefined> {
      const wanted = version ?? guide.version;
      return Promise.resolve(wanted === guide.version ? guide : undefined);
    },
  };
}
