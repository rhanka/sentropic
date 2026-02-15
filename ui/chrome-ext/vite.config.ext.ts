import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    root: path.resolve(__dirname, '../'), // Start from ui/
    plugins: [
        svelte({
            configFile: path.resolve(__dirname, '../svelte.config.js')
        })
    ],
    resolve: {
        alias: {
            '$lib': path.resolve(__dirname, '../src/lib'),
        }
    },
    build: {
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true,
        target: 'esnext',
        minify: false, // Easier debugging for now
        sourcemap: 'inline',
        rollupOptions: {
            input: {
                background: path.resolve(__dirname, 'background.ts'),
                content: path.resolve(__dirname, 'content.ts'),
                popup: path.resolve(__dirname, 'popup.html'),
                sidepanel: path.resolve(__dirname, 'sidepanel.html'),
                chatwidget: path.resolve(__dirname, 'chatwidget-entry.ts')
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: '[name][extname]'
            }
        }
    }
});
