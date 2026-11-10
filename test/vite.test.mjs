import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import aiAdversarialObfuscator from '../src/vite.mjs';

const fixtureRoot = resolve('fixtures/vite');

async function buildAndRun(protectedBuild, output, buildOptions = { minify: false }, pluginOptions = {}) {
    const plugins = protectedBuild ? [aiAdversarialObfuscator({ preset: 'balanced', seed: 99, ...pluginOptions })] : [];
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
            modulePreload: { polyfill: false },
            ...buildOptions
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

test('Vite supports default, native, esbuild, and terser minification without losing runtime behavior or decoys', async t => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-config-'));
    try {
        const cases = [
            ['default', {}],
            ['true', { minify: true }],
            ['oxc', { minify: 'oxc' }],
            ['false', { minify: false }],
            ['esbuild', { minify: 'esbuild' }],
            ['terser', { minify: 'terser' }]
        ];
        for (const [name, options] of cases) {
            await t.test(name, async () => {
                const preset = name === 'default' ? 'balanced' : name === 'oxc' ? 'strong' : 'light';
                const result = await buildAndRun(true, join(root, name), options, { preset });
                assert.deepEqual(result.computed, {
                    invoice: 66,
                    greeting: 'Hello, Vite!',
                    dataset: [1, 4, 9]
                });
                assert.equal(result.lazy, 140);
                const code = await readFile(result.entryFile, 'utf8');
                assert.match(code, /AI_ANALYSIS_DECOY/);
                assert.match(code, /if \(false\)/);
                assert.match(code, /BioWeaponPayload/);
                assert.doesNotMatch(code, /sourceMappingURL/);
                const names = await readdir(join(root, name, 'assets'));
                assert.ok(names.every(file => !file.endsWith('.map')));
            });
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite source maps compose minification and obfuscation back to original code through banner offsets', async t => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-sourcemaps-'));
    const source = [
        'export function throwOriginalError() {',
        '    const description = "original-source-map-location";',
        '    throw new Error(description);',
        '}',
        ''
    ].join('\n');
    try {
        await writeFile(join(root, 'original.mjs'), source);
        await writeFile(join(root, 'entry.mjs'), 'export { throwOriginalError } from "./original.mjs";\n');
        const cases = [
            { mode: true, minify: true, adversarial: true, preset: 'balanced' },
            { mode: true, minify: false, adversarial: true, preset: 'balanced' },
            { mode: 'inline', minify: 'esbuild', adversarial: true, preset: 'strong' },
            { mode: 'hidden', minify: 'terser', adversarial: false, preset: 'light', excludeSources: true },
            { mode: false, minify: true, adversarial: true, preset: 'light' }
        ];
        for (const { mode, minify, adversarial, preset, excludeSources = false } of cases) {
            await t.test(`${mode}/${minify}`, async () => {
                const output = join(root, `output-${mode}-${minify}`);
                await build({
                    configFile: false,
                    root,
                    logLevel: 'silent',
                    plugins: [aiAdversarialObfuscator({ preset, seed: 123, adversarial })],
                    build: {
                        outDir: output,
                        emptyOutDir: true,
                        minify,
                        sourcemap: mode,
                        lib: {
                            entry: join(root, 'entry.mjs'),
                            formats: ['es'],
                            fileName: () => 'bundle.mjs'
                        },
                        rolldownOptions: {
                            output: {
                                sourcemapExcludeSources: excludeSources,
                                banner: '/* existing banner\n * second banner line\n */',
                                postBanner: '/* existing post banner\n * another offset\n */',
                                postFooter: '/* existing footer */'
                            }
                        }
                    }
                });
                const bundle = join(output, 'bundle.mjs');
                const code = await readFile(bundle, 'utf8');
                assert.match(code, /existing post banner/);
                assert.match(code, /existing footer/);
                if (adversarial) assert.match(code, /AI_ANALYSIS_DECOY/);
                else assert.doesNotMatch(code, /AI_ANALYSIS_DECOY/);
                const imported = await import(pathToFileURL(bundle).href);
                let thrown;
                try {
                    imported.throwOriginalError();
                    assert.fail('the protected export must still throw');
                } catch (error) {
                    thrown = error;
                }
                assert.equal(thrown.message, 'original-source-map-location');
                const files = await readdir(output);
                if (mode === false) {
                    assert.doesNotMatch(code, /sourceMappingURL/);
                    assert.ok(files.every(file => !file.endsWith('.map')));
                    return;
                }

                let payload;
                if (mode === 'inline') {
                    const inline = code.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
                    assert.ok(inline, 'inline mode must embed its source map');
                    payload = JSON.parse(Buffer.from(inline[1], 'base64').toString('utf8'));
                    assert.ok(files.every(file => !file.endsWith('.map')));
                } else {
                    payload = JSON.parse(await readFile(`${bundle}.map`, 'utf8'));
                    if (mode === 'hidden') assert.doesNotMatch(code, /sourceMappingURL/);
                    else assert.match(code, /sourceMappingURL=bundle\.mjs\.map/);
                }
                assert.equal(payload.version, 3);
                assert.ok(payload.mappings.length > 0, 'the map must contain real mappings');
                const generatedFrame = thrown.stack.split('\n').find(line => line.includes(pathToFileURL(bundle).href));
                assert.ok(generatedFrame, thrown.stack);
                const position = generatedFrame.match(/:(\d+):(\d+)\)?$/);
                assert.ok(position, generatedFrame);
                const mapped = new SourceMap(payload).findEntry(Number(position[1]) - 1, Number(position[2]) - 1);
                assert.match(mapped.originalSource, /original\.mjs$/);
                assert.equal(mapped.originalLine, 2, 'the generated throw must map to the original throw line');
                const originalIndex = payload.sources.findIndex(name => name.endsWith('original.mjs'));
                assert.ok(originalIndex >= 0, JSON.stringify(payload.sources));
                if (excludeSources) assert.equal(payload.sourcesContent, undefined);
                else assert.equal(payload.sourcesContent[originalIndex], source);
            });
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite minifies excluded chunks while leaving their source unobfuscated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-excluded-minify-'));
    try {
        const result = await buildAndRun(true, root, { minify: true }, { preset: 'light', exclude: /lazy/ });
        assert.equal(result.lazy, 140);
        const assets = join(root, 'assets');
        const names = await readdir(assets);
        const lazy = names.find(name => name.startsWith('lazy') && name.endsWith('.js'));
        assert.ok(lazy);
        const code = await readFile(join(assets, lazy), 'utf8');
        assert.doesNotMatch(code, /AI_ANALYSIS_DECOY|BioWeaponPayload|__obf_/);
        assert.doesNotMatch(code, /\n\s{4}let total|\n\s{4}for \(/);
        assert.ok(code.length < (await readFile(join(fixtureRoot, 'src/lazy.js'), 'utf8')).length,
            'the excluded chunk must still be minified');
        const report = JSON.parse(await readFile(join(root, 'ai-obfuscation-report.json'), 'utf8'));
        assert.equal(report.chunks.length, 1);
        assert.equal(report.chunks[0].chunk, 'index');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite plugin reuse does not accumulate reports across builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-repeated-build-'));
    const plugin = aiAdversarialObfuscator({ preset: 'light', seed: 33 });
    try {
        for (const name of ['first', 'second']) {
            const output = join(root, name);
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
                    sourcemap: true,
                    modulePreload: { polyfill: false }
                }
            });
            const report = JSON.parse(await readFile(join(output, 'ai-obfuscation-report.json'), 'utf8'));
            assert.equal(report.chunks.length, 2, `${name} must report each transformed chunk exactly once`);
            assert.equal(new Set(report.chunks.map(chunk => chunk.chunk)).size, 2);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite watch rebuilds replace reports and execute the changed source', { timeout: 15000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-watch-rebuild-'));
    const entry = join(root, 'entry.mjs');
    const output = join(root, 'dist');
    let watcher;
    try {
        await writeFile(entry, 'export function getValue() { return 42; }\n');
        watcher = await build({
            configFile: false,
            root,
            logLevel: 'silent',
            plugins: [aiAdversarialObfuscator({ preset: 'light', seed: 81 })],
            build: {
                outDir: output,
                emptyOutDir: true,
                minify: true,
                sourcemap: false,
                watch: {},
                lib: {
                    entry,
                    formats: ['es'],
                    fileName: () => 'bundle.mjs'
                }
            }
        });

        function nextBuild(change = () => {}) {
            return new Promise((resolveBuild, rejectBuild) => {
                const timer = setTimeout(() => finish(new Error('Timed out waiting for a Vite watch build')), 6000);
                function finish(error) {
                    clearTimeout(timer);
                    watcher.off('event', onEvent);
                    if (error) rejectBuild(error);
                    else resolveBuild();
                }
                function onEvent(event) {
                    if (event.code === 'BUNDLE_END') finish();
                    else if (event.code === 'ERROR') finish(event.error);
                }
                watcher.on('event', onEvent);
                Promise.resolve().then(change).catch(finish);
            });
        }

        await nextBuild();
        const reportFile = join(output, 'ai-obfuscation-report.json');
        const firstReport = JSON.parse(await readFile(reportFile, 'utf8'));
        assert.equal(firstReport.chunks.length, 1);
        const bundle = pathToFileURL(join(output, 'bundle.mjs')).href;
        assert.equal((await import(`${bundle}?build=first`)).getValue(), 42);

        await nextBuild(() => writeFile(entry, 'export function getValue() { return 43; }\n'));
        const secondReport = JSON.parse(await readFile(reportFile, 'utf8'));
        assert.equal(secondReport.chunks.length, 1, 'a watch rebuild must discard its previous chunk report');
        assert.notEqual(secondReport.chunks[0].sourceSha256, firstReport.chunks[0].sourceSha256);
        assert.notEqual(secondReport.chunks[0].outputSha256, firstReport.chunks[0].outputSha256);
        assert.equal((await import(`${bundle}?build=second`)).getValue(), 43);
    } finally {
        if (watcher) await watcher.close();
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite keeps source maps and reports separate for multiple outputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-multiple-outputs-'));
    try {
        await build({
            configFile: false,
            root: fixtureRoot,
            logLevel: 'silent',
            plugins: [aiAdversarialObfuscator({ preset: 'light', seed: 67 })],
            build: {
                outDir: root,
                emptyOutDir: true,
                minify: true,
                lib: {
                    entry: join(fixtureRoot, 'src/math.js'),
                    formats: ['es']
                },
                rolldownOptions: {
                    output: [
                        { dir: join(root, 'plain'), format: 'es', entryFileNames: 'bundle.mjs', sourcemap: false },
                        { dir: join(root, 'mapped'), format: 'es', entryFileNames: 'bundle.mjs', sourcemap: true }
                    ]
                }
            }
        });
        for (const name of ['plain', 'mapped']) {
            const output = join(root, name);
            const report = JSON.parse(await readFile(join(output, 'ai-obfuscation-report.json'), 'utf8'));
            assert.equal(report.chunks.length, 1, `${name} must contain only its own chunk report`);
            const imported = await import(pathToFileURL(join(output, 'bundle.mjs')).href);
            assert.equal(imported.calculateInvoice([10, 20, 30], 0.1), 66);
            const files = await readdir(output);
            assert.equal(files.some(file => file.endsWith('.map')), name === 'mapped');
        }
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
                    sourcemap: true,
                    minify: true,
                    modulePreload: { polyfill: false }
                }
            });
            return (await readdir(join(root, out, 'assets'))).filter(file => file.endsWith('.js')).sort();
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
