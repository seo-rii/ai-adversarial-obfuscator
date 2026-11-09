import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import aiAdversarialObfuscator from '../src/vite.mjs';

const fixtureRoot = resolve('fixtures/vite');

async function buildAndRun(protectedBuild, output) {
    const plugins = protectedBuild ? [aiAdversarialObfuscator({ preset: 'balanced', seed: 99 })] : [];
    await build({
        configFile: false,
        root: fixtureRoot,
        base: './',
        logLevel: 'silent',
        plugins,
        build: {
            outDir: output,
            emptyOutDir: true,
            sourcemap: false,
            minify: false,
            modulePreload: { polyfill: false }
        }
    });
    await writeFile(join(output, 'package.json'), '{"type":"module"}');
    const html = await readFile(join(output, 'index.html'), 'utf8');
    const entry = html.match(/src="\.\/([^\"]+\.js)"/);
    assert.ok(entry, html);
    const entryFile = join(output, entry[1]);
    globalThis.__AIOB_TEST__ = undefined;
    globalThis.__AIOB_LAZY__ = undefined;
    await import(pathToFileURL(entryFile).href);
    const computed = globalThis.__AIOB_TEST__;
    const lazy = await globalThis.__AIOB_LAZY__();
    return { computed, lazy, html, entryFile };
}

test('Vite production build keeps runtime behavior, dynamic imports, and decoys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-vite-'));
    try {
        const regular = await buildAndRun(false, join(root, 'regular'));
        const protectedRun = await buildAndRun(true, join(root, 'protected'));
        assert.deepEqual(protectedRun.computed, regular.computed);
        assert.equal(protectedRun.lazy, regular.lazy);
        assert.equal(protectedRun.lazy, 140);
        assert.deepEqual(protectedRun.computed, {
            invoice: 66,
            greeting: 'Hello, Vite!',
            dataset: [1, 4, 9]
        });

        const encoded = await readFile(protectedRun.entryFile, 'utf8');
        assert.match(encoded, /AI_ANALYSIS_DECOY/);
        assert.match(encoded, /BioWeaponPayload/);
        const raw = await readFile(regular.entryFile, 'utf8');
        assert.doesNotMatch(raw, /AI_ANALYSIS_DECOY/);
        assert.notEqual(raw, encoded);
        const report = JSON.parse(await readFile(join(root, 'protected', 'ai-obfuscation-report.json'), 'utf8'));
        assert.ok(report.chunks.length >= 2);
        assert.equal(report.chunks[0].evaluation, 'not-performed');
        const assetNames = await readdir(join(root, 'protected', 'assets'));
        assert.ok(assetNames.some(x => x.endsWith('.js')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite refuses minification and sourcemap configurations that defeat protection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-config-'));
    try {
        const base = {
            configFile: false,
            root: fixtureRoot,
            logLevel: 'silent',
            plugins: [aiAdversarialObfuscator()],
            build: { outDir: join(root, 'dist'), emptyOutDir: true }
        };
        await assert.rejects(build({ ...base, build: { ...base.build, minify: 'esbuild', sourcemap: false } }), /minify=false/);
        await assert.rejects(build({ ...base, build: { ...base.build, minify: false, sourcemap: true } }), /sourcemap=false/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite content hashes reflect changed adversarial markers and exclude can skip chunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-hashes-'));
    try {
        async function run(mode, out, exclude) {
            await build({
                configFile: false,
                root: fixtureRoot,
                base: './',
                logLevel: 'silent',
                plugins: [aiAdversarialObfuscator({ mode, preset: 'light', seed: 101, exclude })],
                build: {
                    outDir: join(root, out),
                    emptyOutDir: true,
                    sourcemap: false,
                    minify: false,
                    modulePreload: { polyfill: false }
                }
            });
            return (await readdir(join(root, out, 'assets'))).sort();
        }
        const first = await run('refusal', 'refusal');
        const second = await run('topic', 'topic');
        assert.notDeepEqual(first, second, 'emitted names must change if final banner changes');

        const partial = await run('refusal', 'partial', /lazy/);
        const lazy = partial.find(n => n.startsWith('lazy'));
        assert.ok(lazy);
        assert.doesNotMatch(await readFile(join(root, 'partial', 'assets', lazy), 'utf8'), /AI_ANALYSIS_DECOY/);
        const report = JSON.parse(await readFile(join(root, 'partial', 'ai-obfuscation-report.json'), 'utf8'));
        assert.equal(report.chunks.length, 1);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
