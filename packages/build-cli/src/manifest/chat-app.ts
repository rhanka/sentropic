/**
 * Default scaffold manifest loader for the embedded `templates/chat-app/**` subtree.
 *
 * The CLI is "find template → substitute tokens → write". This loader is the "find
 * template" half: it walks the committed `templates/chat-app` directory and turns every
 * file into a {@link ManifestEntry} whose `content` carries `{{token}}` markers the
 * generator substitutes (R10-deterministic: the walk is sorted, no clock/random/env).
 *
 * The subtree is a self-contained app (its own `package.json`) so it can later lift to a
 * standalone `@sentropic/app-template` package without touching this loader's contract.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import type { ManifestEntry, ScaffoldManifest } from '../templating/types.js';

/**
 * Absolute path to the embedded `templates/chat-app` subtree.
 *
 * Resolved relative to THIS module so it works both from `src/` (strip-types / tsx) and
 * from the built `dist/` (the package ships `templates/` at its root, two levels up from
 * `dist/manifest/` and from `src/manifest/`).
 */
export const CHAT_APP_TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
  'chat-app',
);

/** POSIX-normalise a path segment list into a forward-slash relative path. */
function toPosix(relativePath: string): string {
  return relativePath.split(sep).join('/');
}

/**
 * Translate a dotfile-safe SOURCE path to its real OUTPUT path.
 *
 * npm silently strips any file literally named `.gitignore` from a published tarball, so
 * the template stores it as `_gitignore` and we restore the leading dot here. The
 * convention is general: a basename whose first character is `_` maps to `.` (the
 * create-* / Vite scaffolder idiom). Only the basename is rewritten — directories are
 * untouched — and the mapping is pure, so it preserves the R10 determinism invariant.
 */
function outputPathFor(sourcePosixPath: string): string {
  const slash = sourcePosixPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : sourcePosixPath.slice(0, slash + 1);
  const base = slash === -1 ? sourcePosixPath : sourcePosixPath.slice(slash + 1);
  const rewritten = base.startsWith('_') ? `.${base.slice(1)}` : base;
  return `${dir}${rewritten}`;
}

/**
 * Recursively collect every file under `root`, returning POSIX-relative paths sorted
 * deterministically (case-sensitive byte order) so the manifest order is stable.
 */
function collectFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string): void => {
    const names = readdirSync(absDir).sort();
    for (const name of names) {
      const abs = join(absDir, name);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
      } else if (stat.isFile()) {
        out.push(toPosix(relative(root, abs)));
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Load the chat-app scaffold manifest from the embedded template subtree.
 *
 * Every template file becomes a manifest entry: its content is read verbatim (UTF-8,
 * `{{token}}` markers intact) and its output path mirrors the source path. Executable
 * bits are preserved via {@link ManifestEntry.mode} so the rendered plan is deterministic.
 *
 * @param templateDir override the source directory (tests inject a fixture root).
 */
export function loadChatAppManifest(templateDir: string = CHAT_APP_TEMPLATE_DIR): ScaffoldManifest {
  const files = collectFiles(templateDir);
  const entries: ManifestEntry[] = files.map((relPath): ManifestEntry => {
    const abs = join(templateDir, ...relPath.split('/'));
    const content = readFileSync(abs, 'utf8');
    const mode = statSync(abs).mode;
    const outputPath = outputPathFor(relPath);
    // Only record an executable bit (octal 0o111 any-x) so the plan stays deterministic
    // across umask differences; regular files defer to the writer default.
    const isExecutable = (mode & 0o111) !== 0;
    return isExecutable
      ? { sourcePath: relPath, outputPath, content, mode: 0o755 }
      : { sourcePath: relPath, outputPath, content };
  });
  return { entries };
}

/**
 * The default `manifestProvider` wired into `runAppCli`: loads the embedded chat-app
 * subtree. Kept as a zero-arg thunk so the CLI dispatcher can call it lazily (only on
 * `init`, never on `--help`/`doctor`).
 */
export function defaultChatAppManifestProvider(): ScaffoldManifest {
  return loadChatAppManifest();
}
