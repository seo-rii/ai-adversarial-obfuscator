import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import aiAdversarialObfuscator from '../../src/vite.mjs';

export function browserFixtureConfig({ protectedBuild = true, outDir = 'dist' } = {}) {
    const obfuscation = {
        preset: 'balanced',
        mode: 'topic',
        seed: 2026,
        terms: ['BrowserFixtureMarker'],
        reportFile: false
    };
    return defineConfig({
        root: fileURLToPath(new URL('.', import.meta.url)),
        base: './',
        logLevel: 'silent',
        plugins: protectedBuild ? [aiAdversarialObfuscator(obfuscation)] : [],
        worker: {
            format: 'es',
            plugins: () => protectedBuild ? [aiAdversarialObfuscator(obfuscation)] : []
        },
        build: {
            outDir,
            emptyOutDir: true,
            minify: true,
            sourcemap: 'hidden'
        }
    });
}

export default browserFixtureConfig();
