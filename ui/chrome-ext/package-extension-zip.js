import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(__dirname, 'dist');
const staticChromeExtensionDir = path.resolve(rootDir, 'static', 'chrome-extension');

const zipName = 'top-ai-ideas-chrome-extension.zip';
const zipRootDirectory = 'top-ai-ideas-chrome-extension';
const zipOutputPath = path.join(staticChromeExtensionDir, zipName);

const run = () => {
    if (!fs.existsSync(distDir)) {
        throw new Error(`Extension dist directory not found: ${distDir}`);
    }

    const manifestPath = path.join(distDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Extension manifest not found in dist directory: ${manifestPath}`);
    }

    fs.mkdirSync(staticChromeExtensionDir, { recursive: true });
    fs.rmSync(zipOutputPath, { force: true });

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'top-ai-ideas-ext-zip-'));
    const stagedRoot = path.join(tmpRoot, zipRootDirectory);

    try {
        fs.cpSync(distDir, stagedRoot, { recursive: true });

        const zipResult = spawnSync('zip', ['-rq', zipOutputPath, zipRootDirectory], {
            cwd: tmpRoot,
            stdio: 'inherit',
        });

        if (zipResult.error) {
            if (zipResult.error.code === 'ENOENT') {
                throw new Error(
                    'zip command is not available. Install zip in the UI build image/container before packaging the extension.'
                );
            }
            throw zipResult.error;
        }

        if (zipResult.status !== 0) {
            throw new Error(`zip command failed with status ${zipResult.status ?? 'unknown'}.`);
        }

        console.log(`✅ Extension package created: ${zipOutputPath}`);
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
};

run();
