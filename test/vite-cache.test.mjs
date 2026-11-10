import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import aiAdversarialObfuscator from '../src/vite.mjs';

const reportName = 'ai-obfuscation-report.json';

async function buildLibrary(root, plugin, { sourcemap = true, entries = 'entry.mjs' } = {}) {
    const entry = typeof entries === 'string'
        ? join(root, entries)
        : Object.fromEntries(Object.entries(entries).map(([name, path]) => [name, join(root, path)]));
    const built = await build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [plugin],
        build: {
            write: false,
            outDir: join(root, 'dist'),
            minify: true,
            sourcemap,
            lib: { entry, formats: ['es'] },
            rolldownOptions: {
                output: { entryFileNames: '[name].mjs', chunkFileNames: '[name].mjs' }
            }
        }
    });
    const output = (Array.isArray(built) ? built[0] : built).output;
    const report = JSON.parse(output.find(item => item.fileName === reportName).source);
    const chunks = output.filter(item => item.type === 'chunk');
    const maps = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.map'))
        .map(item => ({ name: item.fileName, source: item.source }));
    return { report, chunks, maps };
}

async function valueOf(chunk) {
    const imported = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
    return imported.getValue();
}

function assertGeneration(result, { hits, misses, cached }) {
    const { cache } = result.report;
    assert.equal(cache.enabled, true);
    assert.equal(cache.hits, hits);
    assert.equal(cache.misses, misses);
    assert.equal(result.report.chunks[0].cacheHit, cached);
    assert.ok(Number.isSafeInteger(cache.entries) && cache.entries >= 0);
    assert.ok(Number.isSafeInteger(cache.bytes) && cache.bytes >= 0);
    assert.ok(Number.isFinite(result.report.chunks[0].transformMs) && result.report.chunks[0].transformMs >= 0);
}

test('Vite caches repeated chunk transformations without changing code, hashes, or maps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cache-repeat-'));
    const plugin = aiAdversarialObfuscator({ preset: 'light', seed: 31 });
    try {
        await writeFile(join(root, 'entry.mjs'), 'export function getValue() { return 42; }\n');
        const first = await buildLibrary(root, plugin);
        const originalCode = first.chunks[0].code;
        const originalMaps = structuredClone(first.maps);
        const originalDigest = first.report.chunks[0].outputSha256;
        assertGeneration(first, { hits: 0, misses: 1, cached: false });
        assert.equal(first.report.cache.entries, 1);
        assert.ok(first.report.cache.bytes > 0);
        // Consumers of a build result must not mutate the retained transform map.
        first.chunks[0].map.names.push('changed-after-build');
        first.chunks[0].map.sourcesContent?.fill('changed-after-build');

        const second = await buildLibrary(root, plugin);
        assertGeneration(second, { hits: 1, misses: 0, cached: true });
        assert.equal(second.report.cache.entries, 1);
        assert.equal(second.report.cache.evictions, 0);
        assert.equal(second.chunks[0].code, originalCode);
        assert.equal(second.report.chunks[0].outputSha256, originalDigest);
        assert.equal(second.report.files[0].sha256, first.report.files[0].sha256);
        assert.deepEqual(second.maps, originalMaps);
        assert.equal(await valueOf(second.chunks[0]), 42);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite invalidates cached transformations when effective policy or input source changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cache-inputs-'));
    let seed = 41;
    const plugin = aiAdversarialObfuscator({ preset: 'light', chunkOptions: () => ({ seed }) });
    try {
        const entry = join(root, 'entry.mjs');
        await writeFile(entry, 'export function getValue() { return 42; }\n');
        const first = await buildLibrary(root, plugin);
        assertGeneration(first, { hits: 0, misses: 1, cached: false });

        seed = 42;
        const changedPolicy = await buildLibrary(root, plugin);
        assertGeneration(changedPolicy, { hits: 0, misses: 1, cached: false });
        assert.notEqual(changedPolicy.report.chunks[0].outputSha256, first.report.chunks[0].outputSha256);
        const samePolicy = await buildLibrary(root, plugin);
        assertGeneration(samePolicy, { hits: 1, misses: 0, cached: true });

        await writeFile(entry, 'export function getValue() { return 43; }\n');
        const changedSource = await buildLibrary(root, plugin);
        assertGeneration(changedSource, { hits: 0, misses: 1, cached: false });
        assert.equal(await valueOf(changedSource.chunks[0]), 43);
        assert.notEqual(changedSource.report.chunks[0].sourceSha256, samePolicy.report.chunks[0].sourceSha256);
        const sameSource = await buildLibrary(root, plugin);
        assertGeneration(sameSource, { hits: 1, misses: 0, cached: true });
        assert.equal(await valueOf(sameSource.chunks[0]), 43);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite distinguishes source-map output modes in cached transformations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cache-map-mode-'));
    const plugin = aiAdversarialObfuscator({ preset: 'light', seed: 13 });
    try {
        await writeFile(join(root, 'entry.mjs'), 'export function getValue() { return 42; }\n');
        const linked = await buildLibrary(root, plugin, { sourcemap: true });
        assertGeneration(linked, { hits: 0, misses: 1, cached: false });
        assert.match(linked.chunks[0].code, /sourceMappingURL/);
        const hidden = await buildLibrary(root, plugin, { sourcemap: 'hidden' });
        assertGeneration(hidden, { hits: 0, misses: 1, cached: false });
        assert.doesNotMatch(hidden.chunks[0].code, /sourceMappingURL/);
        assert.equal(hidden.maps.length, 1);
        const sameMode = await buildLibrary(root, plugin, { sourcemap: 'hidden' });
        assertGeneration(sameMode, { hits: 1, misses: 0, cached: true });
        assert.deepEqual(sameMode.maps, hidden.maps);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite cache can be disabled without changing transformed output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cache-disabled-'));
    const plugin = aiAdversarialObfuscator({ preset: 'light', seed: 53, cache: false });
    try {
        await writeFile(join(root, 'entry.mjs'), 'export function getValue() { return 42; }\n');
        const first = await buildLibrary(root, plugin);
        const second = await buildLibrary(root, plugin);
        for (const result of [first, second]) {
            assert.equal(result.report.cache.enabled, false);
            assert.equal(result.report.cache.hits, 0);
            assert.equal(result.report.cache.entries, 0);
            assert.equal(result.report.cache.bytes, 0);
            assert.equal(result.report.cache.evictions, 0);
            assert.equal(result.report.chunks[0].cacheHit, false);
        }
        assert.equal(second.chunks[0].code, first.chunks[0].code);
        assert.deepEqual(second.maps, first.maps);
        assert.equal(await valueOf(second.chunks[0]), 42);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite evicts cached entries to respect the entry limit across output generations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cache-entries-'));
    const plugin = aiAdversarialObfuscator({ preset: 'light', seed: 61, cache: { maxEntries: 1 } });
    try {
        await writeFile(join(root, 'alpha.mjs'), 'export const alpha = 1;\n');
        await writeFile(join(root, 'beta.mjs'), 'export const beta = 2;\n');
        const options = { entries: { alpha: 'alpha.mjs', beta: 'beta.mjs' } };
        const first = await buildLibrary(root, plugin, options);
        assert.equal(first.report.cache.hits, 0);
        assert.equal(first.report.cache.misses, 2);
        assert.equal(first.report.cache.entries, 1);
        assert.equal(first.report.cache.evictions, 1);
        const second = await buildLibrary(root, plugin, options);
        assert.equal(second.report.cache.entries, 1);
        assert.equal(second.report.cache.hits + second.report.cache.misses, 2);
        assert.ok(second.report.cache.misses >= 1);
        assert.ok(second.report.cache.evictions >= 1);
        assert.deepEqual(second.chunks.map(chunk => chunk.code), first.chunks.map(chunk => chunk.code));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite does not retain transformations larger than the configured byte limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cache-bytes-'));
    const plugin = aiAdversarialObfuscator({ preset: 'light', seed: 71, cache: { maxBytes: 1 } });
    try {
        await writeFile(join(root, 'entry.mjs'), 'export function getValue() { return 42; }\n');
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await buildLibrary(root, plugin);
            assertGeneration(result, { hits: 0, misses: 1, cached: false });
            assert.equal(result.report.cache.entries, 0);
            assert.equal(result.report.cache.bytes, 0);
            assert.equal(await valueOf(result.chunks[0]), 42);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite rejects invalid cache settings', () => {
    for (const cache of [
        null, [], 'enabled',
        { maxEntries: 0 }, { maxEntries: -1 }, { maxEntries: 1.5 },
        { maxEntries: Infinity }, { maxBytes: 0 }, { maxBytes: -1 },
        { maxBytes: Number.MAX_SAFE_INTEGER + 1 }, { maxBytes: NaN },
        { unknown: 1 }
    ]) {
        assert.throws(() => aiAdversarialObfuscator({ cache }), /cache|maxEntries|maxBytes/i);
    }
});

test('Vite watch rebuilds reuse unchanged chunks and transform changed entries', { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cache-watch-'));
    let watcher;
    try {
        const alpha = join(root, 'alpha.mjs');
        const beta = join(root, 'beta.mjs');
        const output = join(root, 'dist');
        await writeFile(alpha, 'export const value = 1;\n');
        await writeFile(beta, 'export const value = 2;\n');
        watcher = await build({
            configFile: false, root, logLevel: 'silent',
            plugins: [aiAdversarialObfuscator({ preset: 'light' })],
            build: {
                outDir: output, emptyOutDir: true, minify: true, sourcemap: true, watch: {},
                lib: { entry: { alpha, beta }, formats: ['es'] },
                rolldownOptions: { output: { entryFileNames: '[name].mjs' } }
            }
        });
        function nextBuild(change = () => {}) {
            return new Promise((resolveBuild, rejectBuild) => {
                const timer = setTimeout(() => finish(new Error('Timed out waiting for cached watch build')), 8000);
                function finish(error) {
                    clearTimeout(timer);
                    watcher.off('event', onEvent);
                    if (error) rejectBuild(error);
                    else resolveBuild();
                }
                function onEvent(event) {
                    if (event.code === 'END') finish();
                    else if (event.code === 'ERROR') finish(event.error);
                }
                watcher.on('event', onEvent);
                Promise.resolve().then(change).catch(finish);
            });
        }
        await nextBuild();
        const initial = JSON.parse(await readFile(join(output, reportName), 'utf8'));
        assert.equal(initial.cache.misses, 2);
        const betaBefore = await readFile(join(output, 'beta.mjs'), 'utf8');
        await nextBuild(async () => {
            // Publish a complete source update, rather than letting the watcher
            // observe a transiently truncated file under concurrent test load.
            await writeFile(`${alpha}.next`, 'export const value = 3;\n');
            await rename(`${alpha}.next`, alpha);
        });
        const rebuilt = JSON.parse(await readFile(join(output, reportName), 'utf8'));
        assert.equal(rebuilt.cache.hits, 1);
        assert.equal(rebuilt.cache.misses, 1);
        assert.equal(rebuilt.chunks.find(chunk => chunk.chunk === 'beta').cacheHit, true);
        assert.equal(rebuilt.chunks.find(chunk => chunk.chunk === 'alpha').cacheHit, false);
        assert.equal(await readFile(join(output, 'beta.mjs'), 'utf8'), betaBefore);
        const changedCode = await readFile(join(output, 'alpha.mjs'), 'utf8');
        const changed = await import(`data:text/javascript;base64,${Buffer.from(changedCode).toString('base64')}`);
        assert.equal(changed.value, 3);
    } finally {
        if (watcher) await watcher.close();
        await rm(root, { recursive: true, force: true });
    }
});
