import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { prepareDossierScenes, sliceTranslations } from './dossier-input.mjs';
import { inlinePortable } from './portable.mjs';
import { artifactAttribution } from './artifact-attribution.mjs';
import { measureArtifact, reportTable, fileReceipt } from './artifact-budget.mjs';

const profile = process.argv[2] ?? 'typical';
if (!['typical', 'baseline', 'governance'].includes(profile)) throw new Error(`Unknown fixture: ${profile}`);
const root = process.cwd(), fixture = join(root, 'fixtures/artifact-weight');
const scratch = join(root, '.cache/artifact-weight', profile);
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
const write = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
cpSync(join(root, 'src'), join(scratch, 'src'), { recursive: true });
cpSync(join(root, 'dossier.json'), join(scratch, 'dossier.json'));
cpSync(join(root, 'index.html'), join(scratch, 'index.html'));
const inputs = {};
if (profile !== 'governance') {
  for (const file of ['App.svelte', 'harness-content.json', 'harness-scenes.json', 'harness.css']) {
    cpSync(join(fixture, file), join(scratch, 'src', file));
    inputs[file] = fileReceipt(readFileSync(join(fixture, file))).sha256;
  }
  cpSync(join(fixture, 'dossier.json'), join(scratch, 'dossier.json'));
  inputs['dossier.json'] = fileReceipt(readFileSync(join(fixture, 'dossier.json'))).sha256;
  const scenes = prepareDossierScenes(json(join(fixture, 'harness-scenes.json')));
  const fullDictionary = json(join(root, 'src/i18n-en.json'));
  const dictionary = profile === 'baseline' ? fullDictionary : sliceTranslations(fullDictionary,
    [scenes, json(join(fixture, 'dossier.json')), json(join(fixture, 'harness-content.json'))],
    ['ArchitectureFigure.svelte', 'FrameToggle.svelte'].map(file => read(join(root, 'src', file))));
  write(join(scratch, 'src/dossier-translations.json'), dictionary);
  write(join(scratch, 'src/harness-scenes.json'), scenes);
  // Reproduce the old global data boundary deliberately as a negative build.
  const legacy = profile === 'baseline' ? `
import routes from './governance-routes.json';
import layouts from './governance-summary-layouts.json';
import scenes from './harness-scenes.json';
for (const scene of Object.values(scenes)) Object.assign(scene, {projectionRoutes:routes[scene.language], summaryLayout:layouts[scene.language]});` : '';
  write(join(scratch, 'src/main.js'), `import {mount} from 'svelte';
import App from './App.svelte';
import {configureTranslations} from './i18n.js';
import dictionary from './dossier-translations.json';
import './app.css'; import './harness.css';
${legacy}
configureTranslations(dictionary);
mount(App,{target:document.getElementById('app')});`);
  write(join(scratch, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>');
}
await build({ root: scratch, configFile: false, plugins: [svelte({ configFile: false }), artifactAttribution()],
  resolve: { dedupe: ['svelte', '@sentropic/design-system-svelte', '@sentropic/design-system-themes'] },
  build: { target: 'es2022', manifest: true, outDir: 'dist', emptyOutDir: true } });
const directory = join(scratch, 'dist'), portablePath = join(directory, 'dossier-portable.html');
write(portablePath, inlinePortable(read(join(directory, 'index.html')), path => read(join(directory, path.replace(/^\//, '')))));
const report = measureArtifact({ directory, portablePath, profile: profile === 'governance' ? 'governance' : 'typical' });
const lock = json(join(root, 'package-lock.json'));
report.build = { commit: process.env.ARTIFACT_COMMIT ?? 'unknown', fixture: profile, node: process.version,
  lockSha256: fileReceipt(readFileSync(join(root, 'package-lock.json'))).sha256, inputs,
  toolchain: Object.fromEntries(['vite', 'svelte', 'esbuild', 'rollup', '@sentropic/design-system-svelte', '@sentropic/design-system-themes']
    .map(name => [name, lock.packages[`node_modules/${name}`].version])),
  configuration: { target: 'es2022', minifier: 'esbuild', manifest: true, sourcemap: false } };
report.attribution = json(join(directory, '.vite/module-attribution.json'));
report.inputDigest = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
write(join(scratch, 'artifact-size-report.json'), JSON.stringify(report, null, 2));
write(join(scratch, 'artifact-size-report.md'), reportTable(report));
console.log(reportTable(report));
if (profile === 'baseline') {
  if (!report.violations.some(message => message.startsWith('js:'))) throw new Error('Corpus reimport did not trip the size gate');
} else if (report.violations.length) process.exitCode = 1;
