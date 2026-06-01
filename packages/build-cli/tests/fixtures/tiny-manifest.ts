/**
 * A TINY in-repo scaffold manifest for the command-layer tests.
 *
 * This is NOT the real `templates/chat-app/**` subtree (that lands in a later lot). It is
 * just large enough to exercise the `init` orchestration end-to-end: token substitution
 * into paths + content (name/slug/ports/provider/repo_url), a `.gitignore` that MUST
 * exclude `.env` (no-secret-leak invariant), and a couple of nested files so the writer's
 * directory creation is covered.
 */

import type { ScaffoldManifest } from '../../src/templating/index.js';

export const TINY_FIXTURE_MANIFEST: ScaffoldManifest = {
    entries: [
        {
            sourcePath: 'package.json.tmpl',
            outputPath: 'package.json',
            content:
                '{\n' +
                '  "name": "{{slug}}",\n' +
                '  "version": "0.1.0",\n' +
                '  "private": true,\n' +
                '  "repository": "{{repo_url}}"\n' +
                '}\n',
        },
        {
            sourcePath: 'README.md.tmpl',
            outputPath: 'README.md',
            content: '# {{name}}\n\nProvider: {{provider}}\nUI on {{ui_port}}, API on {{api_port}}.\n',
        },
        {
            // The no-secret-leak invariant: the generated .gitignore MUST exclude .env.
            sourcePath: 'gitignore.tmpl',
            outputPath: '.gitignore',
            content: 'node_modules\n.env\n.env.*\ndist\n',
        },
        {
            sourcePath: 'env.example.tmpl',
            outputPath: '.env.example',
            content: 'API_PORT={{api_port}}\nUI_PORT={{ui_port}}\nPROVIDER={{provider}}\n',
        },
        {
            sourcePath: 'src/server.ts.tmpl',
            outputPath: 'api/src/server.ts',
            content: "export const provider = '{{provider}}';\nexport const apiPort = {{api_port}};\n",
        },
    ],
};
