import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import aiAdversarialObfuscator from '../src/vite.mjs';

const fixtureRoot = resolve('fixtures/vite');

async function buildFixture(output, plugin) {
    await build({
        configFile: false,
        root: fixtureRoot,
        base: './',
        logLevel: 'silent',
        plugins: [plugin],
        build: {
            outDir: output,
            emptyOutDir: true,
            minify: true,
            sourcemap: 'hidden',
            modulePreload: { polyfill: false }
        }
    });
    await writeFile(join(output, 'package.json'), '{"type":"module"}');
    const report = JSON.parse(await readFile(join(output, 'ai-obfuscation-report.json'), 'utf8'));
    const assets = join(output, 'assets');
    const names = (await readdir(assets)).filter(name => name.endsWith('.js'));
    const chunks = Object.fromEntries(await Promise.all(names.map(async name => [
        name.startsWith('lazy-') ? 'lazy' : 'index',
        { name, code: await readFile(join(assets, name), 'utf8') }
    ])));
    const entry = names.find(name => name.startsWith('index-'));
    assert.ok(entry, JSON.stringify(names));
    await import(pathToFileURL(join(assets, entry)).href);
    assert.deepEqual(globalThis.__AIOB_TEST__, {
        invoice: 66,
        greeting: 'Hello, Vite!',
        dataset: [1, 4, 9]
    });
    assert.equal(await globalThis.__AIOB_LAZY__(), 140);
    return { chunks, report };
}

test('Vite chunk policies use module metadata once and keep transformation and final markers consistent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-chunk-policy-'));
    const calls = [];
    try {
        const plugin = aiAdversarialObfuscator({
            preset: 'balanced',
            seed: 17,
            terms: ['GlobalPolicy'],
            chunkOptions(chunk) {
                calls.push({ ...chunk, moduleIds: [...chunk.moduleIds] });
                if (chunk.moduleIds.some(id => id.endsWith('/src/lazy.js'))) {
                    return { preset: 'light', seed: 81, terms: ['LazyPolicy'], mode: 'refusal' };
                }
                return { preset: 'strong', seed: 73, terms: ['EntryPolicy'], mode: 'topic' };
            }
        });
        const { chunks, report } = await buildFixture(root, plugin);
        assert.equal(calls.length, 2, 'rendering and final markers must reuse the same policy decision');
        assert.equal(new Set(calls.map(chunk => chunk.name)).size, 2);
        const entry = calls.find(chunk => chunk.isEntry);
        const lazy = calls.find(chunk => chunk.isDynamicEntry);
        assert.ok(entry);
        assert.ok(lazy);
        assert.equal(entry.name, 'index');
        assert.equal(lazy.name, 'lazy');
        assert.equal(typeof entry.fileName, 'string');
        assert.ok(entry.moduleIds.some(id => id.endsWith('/src/main.js')));
        assert.ok(entry.moduleIds.some(id => id.endsWith('/src/math.js')));
        assert.ok(lazy.moduleIds.some(id => id.endsWith('/src/lazy.js')));
        assert.equal(typeof lazy.facadeModuleId, 'string');

        const reports = Object.fromEntries(report.chunks.map(item => [item.chunk, item]));
        assert.equal(reports.index.preset, 'strong');
        assert.equal(reports.index.seed, 73);
        assert.equal(reports.index.mode, 'topic');
        assert.equal(reports.lazy.preset, 'light');
        assert.equal(reports.lazy.seed, 81);
        assert.equal(reports.lazy.mode, 'refusal');
        assert.match(chunks.index.code, /AI_ANALYSIS_DECOY/);
        assert.match(chunks.index.code, /EntryPolicy/);
        assert.doesNotMatch(chunks.index.code, /LazyPolicy|GlobalPolicy|BioWeaponPayload/);
        assert.match(chunks.lazy.code, /AI_ANALYSIS_DECOY/);
        assert.match(chunks.lazy.code, /LazyPolicy/);
        assert.doesNotMatch(chunks.lazy.code, /EntryPolicy|GlobalPolicy|BioWeaponPayload/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite false chunk policies skip obfuscation and markers while retaining minification and imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-skipped-policy-'));
    const calls = [];
    try {
        const { chunks, report } = await buildFixture(root, aiAdversarialObfuscator({
            preset: 'light',
            terms: ['SelectedPolicy'],
            chunkOptions(chunk) {
                calls.push(chunk.name);
                return chunk.isDynamicEntry ? false : undefined;
            }
        }));
        assert.deepEqual(calls.sort(), ['index', 'lazy']);
        assert.match(chunks.index.code, /SelectedPolicy/);
        assert.doesNotMatch(chunks.lazy.code, /AI_ANALYSIS_DECOY|SelectedPolicy|__obf_/);
        assert.ok(chunks.lazy.code.length < (await readFile(join(fixtureRoot, 'src/lazy.js'), 'utf8')).length);
        assert.deepEqual(report.chunks.map(chunk => chunk.chunk), ['index']);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite include and exclude filters run before chunk policies and undefined inherits global options', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-filtered-policy-'));
    const calls = [];
    try {
        const { chunks, report } = await buildFixture(root, aiAdversarialObfuscator({
            preset: 'light',
            seed: 29,
            mode: 'topic',
            terms: ['InheritedPolicy'],
            include: ['index', 'lazy'],
            exclude: /lazy/,
            chunkOptions(chunk) {
                calls.push(chunk.name);
            }
        }));
        assert.deepEqual(calls, ['index']);
        assert.equal(report.chunks.length, 1);
        assert.equal(report.chunks[0].preset, 'light');
        assert.equal(report.chunks[0].seed, 29);
        assert.equal(report.chunks[0].mode, 'topic');
        assert.match(chunks.index.code, /InheritedPolicy/);
        assert.doesNotMatch(chunks.lazy.code, /AI_ANALYSIS_DECOY|InheritedPolicy/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite reused plugins reevaluate chunk policy once per chunk in every output generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-policy-reuse-'));
    const calls = [];
    let generation = 'FirstPolicy';
    const plugin = aiAdversarialObfuscator({
        preset: 'light',
        seed: 41,
        chunkOptions(chunk) {
            calls.push(`${generation}:${chunk.name}`);
            return { terms: [generation], mode: 'topic' };
        }
    });
    try {
        const first = await buildFixture(join(root, 'first'), plugin);
        generation = 'SecondPolicy';
        const second = await buildFixture(join(root, 'second'), plugin);
        assert.deepEqual(calls.sort(), [
            'FirstPolicy:index', 'FirstPolicy:lazy', 'SecondPolicy:index', 'SecondPolicy:lazy'
        ]);
        for (const name of ['index', 'lazy']) {
            assert.match(first.chunks[name].code, /FirstPolicy/);
            assert.doesNotMatch(first.chunks[name].code, /SecondPolicy/);
            assert.match(second.chunks[name].code, /SecondPolicy/);
            assert.doesNotMatch(second.chunks[name].code, /FirstPolicy/);
            assert.notEqual(first.chunks[name].name, second.chunks[name].name);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite rejects invalid chunk policy results and invalid merged options', async t => {
    for (const [name, result] of [
        ['number', 42],
        ['string', 'strong'],
        ['true', true],
        ['null', null],
        ['array', []],
        ['promise', Promise.resolve({ preset: 'light' })],
        ['invalid preset', { preset: 'unsupported' }],
        ['invalid seed', { seed: 0 }]
    ]) {
        await t.test(name, async () => {
            await assert.rejects(async () => build({
                configFile: false,
                root: fixtureRoot,
                logLevel: 'silent',
                plugins: [aiAdversarialObfuscator({ chunkOptions: () => result })],
                build: {
                    write: false,
                    minify: true,
                    lib: {
                        entry: join(fixtureRoot, 'src/math.js'),
                        formats: ['es']
                    }
                }
            }));
        });
    }
});
