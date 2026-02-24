import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const extDir = path.resolve(rootDir, 'chrome-ext');
const distDir = path.resolve(extDir, 'dist');
const staticDir = path.resolve(rootDir, 'static');
const packageJsonPath = path.resolve(rootDir, 'package.json');
const manifestPath = path.resolve(extDir, 'manifest.json');

console.log('📋 Copying extension assets...');

// Ensure dist directory exists (should be created by vite build)
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifest = {
    ...sourceManifest,
    version: packageJson.version,
};

fs.writeFileSync(
    path.join(distDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
);

fs.writeFileSync(
    path.join(distDir, 'extension-metadata.json'),
    `${JSON.stringify(
        {
            version: manifest.version,
            source: 'ui/chrome-ext',
        },
        null,
        2
    )}\n`,
    'utf8'
);

// Create icons directory
const iconsDir = path.join(distDir, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

// Copy favicon to icons (resizing not possible without sharp, just copy for now)
const sizes = ['16', '32', '48', '128'];
const faviconPath = path.join(staticDir, 'favicon.png');

if (fs.existsSync(faviconPath)) {
    sizes.forEach(size => {
        fs.copyFileSync(faviconPath, path.join(iconsDir, `icon-${size}.png`));
    });
} else {
    console.warn('⚠️  favicon.png not found in static directory');
}

// Create assets directory if needed
const assetsDir = path.join(distDir, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

console.log('✅ Assets copied successfully');
