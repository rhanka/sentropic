import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.resolve(__dirname, 'package.json');
const extensionEntryPoint = path.resolve(__dirname, 'extension.ts');
const extensionIconPath = path.resolve(__dirname, 'topai-icon.svg');
const distDir = path.resolve(__dirname, 'dist');
const distExtensionPath = path.join(distDir, 'extension.cjs');
const distWebviewPath = path.join(distDir, 'webview-entry.js');
const staticVsCodeExtensionDir = path.resolve(rootDir, 'static', 'vscode-extension');
const vsixName = 'top-ai-ideas-vscode-extension.vsix';
const vsixOutputPath = path.join(staticVsCodeExtensionDir, vsixName);
const nodeProcess = globalThis.process;
const DEFAULT_EXTENSION_API_BASE_URL =
  nodeProcess.env.VITE_EXTENSION_API_BASE_URL || 'http://localhost:8787/api/v1';
const DEFAULT_EXTENSION_APP_BASE_URL =
  nodeProcess.env.VITE_EXTENSION_APP_BASE_URL || 'http://localhost:5173';

const xmlEscape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const loadManifest = () => {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  const required = ['name', 'publisher', 'version', 'displayName', 'description'];
  for (const field of required) {
    if (!manifest[field] || String(manifest[field]).trim().length === 0) {
      throw new Error(`Missing required VSCode manifest field: ${field}`);
    }
  }

  const engine = manifest?.engines?.vscode;
  if (!engine || String(engine).trim().length === 0) {
    throw new Error('Missing required VSCode manifest field: engines.vscode');
  }

  return {
    name: String(manifest.name).trim(),
    publisher: String(manifest.publisher).trim(),
    version: String(manifest.version).trim(),
    displayName: String(manifest.displayName).trim(),
    description: String(manifest.description).trim(),
    engine: String(engine).trim(),
  };
};

const createVsixManifestXml = (manifest) => `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity
      Language="en-US"
      Id="${xmlEscape(`${manifest.publisher}.${manifest.name}`)}"
      Version="${xmlEscape(manifest.version)}"
      Publisher="${xmlEscape(manifest.publisher)}" />
    <DisplayName>${xmlEscape(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${xmlEscape(manifest.description)}</Description>
    <Tags>top-ai-ideas,vscode,agent,workflow</Tags>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xmlEscape(manifest.engine)}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;

const createContentTypesXml = () => `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="xml" ContentType="text/xml" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
`;

const packageVsix = () => {
  const manifest = loadManifest();

  if (!fs.existsSync(distExtensionPath)) {
    throw new Error(`VSCode extension bundle not found: ${distExtensionPath}`);
  }
  if (!fs.existsSync(distWebviewPath)) {
    throw new Error(`VSCode webview bundle not found: ${distWebviewPath}`);
  }

  fs.mkdirSync(staticVsCodeExtensionDir, { recursive: true });
  fs.rmSync(vsixOutputPath, { force: true });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'top-ai-ideas-vsix-'));
  const stagedRoot = path.join(tmpRoot, 'stage');
  const stagedExtensionRoot = path.join(stagedRoot, 'extension');

  try {
    fs.mkdirSync(stagedExtensionRoot, { recursive: true });
    fs.cpSync(manifestPath, path.join(stagedExtensionRoot, 'package.json'));
    fs.cpSync(extensionIconPath, path.join(stagedExtensionRoot, 'topai-icon.svg'));
    fs.cpSync(distDir, path.join(stagedExtensionRoot, 'dist'), { recursive: true });

    fs.writeFileSync(path.join(stagedRoot, '[Content_Types].xml'), createContentTypesXml(), 'utf8');
    fs.writeFileSync(path.join(stagedRoot, 'extension.vsixmanifest'), createVsixManifestXml(manifest), 'utf8');

    const zipResult = spawnSync('zip', ['-rq', vsixOutputPath, '.'], {
      cwd: stagedRoot,
      stdio: 'inherit',
    });

    if (zipResult.error) {
      if (zipResult.error.code === 'ENOENT') {
        throw new Error(
          'zip command is not available. Install zip in the UI build image/container before packaging the VSCode extension.'
        );
      }
      throw zipResult.error;
    }

    if (zipResult.status !== 0) {
      throw new Error(`zip command failed with status ${zipResult.status ?? 'unknown'}.`);
    }

    console.log(`✅ VSCode extension package created: ${vsixOutputPath}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
};

const buildHostBundle = async () => {
  await esbuild.build({
    entryPoints: [extensionEntryPoint],
    bundle: true,
    platform: 'node',
    target: ['node18'],
    format: 'cjs',
    external: ['vscode'],
    define: {
      __TOPAI_DEFAULT_API_BASE_URL__: JSON.stringify(DEFAULT_EXTENSION_API_BASE_URL),
      __TOPAI_DEFAULT_APP_BASE_URL__: JSON.stringify(DEFAULT_EXTENSION_APP_BASE_URL),
    },
    outfile: distExtensionPath,
    sourcemap: false,
    logLevel: 'info',
  });
};

const buildWebviewBundle = async () => {
  const result = spawnSync('npm', ['run', 'build:vscode-webview'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`VSCode webview build failed (status ${result.status ?? 'unknown'}).`);
  }
};

const buildAndPackage = async () => {
  await buildHostBundle();
  await buildWebviewBundle();
  packageVsix();
};

const runWatch = async () => {
  const packageOnSuccess = (result) => {
    if (result.errors.length > 0) return;
    try {
      packageVsix();
    } catch (error) {
      console.error(error);
    }
  };

  const hostCtx = await esbuild.context({
    entryPoints: [extensionEntryPoint],
    bundle: true,
    platform: 'node',
    target: ['node18'],
    format: 'cjs',
    external: ['vscode'],
    define: {
      __TOPAI_DEFAULT_API_BASE_URL__: JSON.stringify(DEFAULT_EXTENSION_API_BASE_URL),
      __TOPAI_DEFAULT_APP_BASE_URL__: JSON.stringify(DEFAULT_EXTENSION_APP_BASE_URL),
    },
    outfile: distExtensionPath,
    sourcemap: false,
    logLevel: 'info',
    plugins: [
      {
        name: 'package-vsix-on-build',
        setup(build) {
          build.onEnd(packageOnSuccess);
        },
      },
    ],
  });

  await hostCtx.watch();
  await buildWebviewBundle();
  await hostCtx.rebuild();
  packageVsix();

  console.log(
    '👀 Watching VSCode host sources (extension.ts). Re-run dev-vscode-ext after webview (Svelte) changes.'
  );
  nodeProcess.stdin.resume();
};

const run = async () => {
  if (nodeProcess.argv.includes('--watch')) {
    await runWatch();
    return;
  }

  await buildAndPackage();
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  nodeProcess.exitCode = 1;
});
