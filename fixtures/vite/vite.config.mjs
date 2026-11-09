import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import aiAdversarialObfuscator from '../../src/vite.mjs';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    build: {
        outDir: 'dist',
        minify: false,
        sourcemap: false,
        modulePreload: { polyfill: false }
    },
    plugins: [aiAdversarialObfuscator({ preset: 'balanced', seed: 2026 })]
});
