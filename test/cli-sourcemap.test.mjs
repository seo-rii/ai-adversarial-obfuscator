import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI = resolve('bin/ai-obfuscate.mjs');
const source = 'module.exports = function explode() {\n    const message = "cli-map-location";\n    throw new Error(message);\n};\n';

function runCli(args, input) {
    return spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8', input, timeout: 30000, cwd: resolve('.')
    });
}

function assertOriginalLocation(output, map, input) {
    const execution = spawnSync(process.execPath, ['-e', `
        try { require(${JSON.stringify(output)})(); }
        catch (error) { console.log(JSON.stringify({message:error.message,stack:error.stack})); }
    `], { encoding: 'utf8', timeout: 5000 });
    assert.equal(execution.status, 0, execution.stderr);
    const failure = JSON.parse(execution.stdout);
    assert.equal(failure.message, 'cli-map-location');
    const frame = failure.stack.split('\n').find(line => line.includes(`${output}:`));
    assert.ok(frame, failure.stack);
    const position = frame.match(/:(\d+):(\d+)\)?$/);
    assert.ok(position, frame);
    const mapped = new SourceMap(map).findEntry(Number(position[1]) - 1, Number(position[2]) - 1);
    assert.equal(mapped.originalLine, 2);
    assert.equal(map.sourcesContent[0], source);
    assert.ok(map.sources[0].endsWith(basename(input)));
}

test('CLI emits all source-map modes with correct original error locations', async t => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-map-modes-'));
    try {
        const input = join(root, 'original.cjs');
        await writeFile(input, source);
        for (const mode of ['false', 'true', 'inline', 'hidden']) {
            await t.test(mode, async () => {
                const output = join(root, mode, 'protected.cjs');
                const result = runCli([input, '-o', output, '--preset', 'light', '--target', 'node', '--sourcemap', mode]);
                assert.equal(result.status, 0, result.stderr);
                const code = await readFile(output, 'utf8');
                if (mode === 'false') {
                    assert.doesNotMatch(code, /sourceMappingURL/);
                    await assert.rejects(readFile(`${output}.map`), { code: 'ENOENT' });
                    return;
                }
                let map;
                if (mode === 'inline') {
                    const encoded = code.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
                    assert.ok(encoded, code);
                    map = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'));
                    await assert.rejects(readFile(`${output}.map`), { code: 'ENOENT' });
                } else {
                    map = JSON.parse(await readFile(`${output}.map`, 'utf8'));
                    if (mode === 'hidden') assert.doesNotMatch(code, /sourceMappingURL/);
                    else assert.match(code, /sourceMappingURL=protected\.cjs\.map/);
                }
                assert.equal(map.file, basename(output));
                assert.deepEqual(map.sources, [relative(dirname(output), input)]);
                assertOriginalLocation(output, map, input);
            });
        }
        assert.equal(await readFile(input, 'utf8'), source);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI custom map paths escape links and rebase sources relative to the map file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-custom-map-'));
    try {
        const input = join(root, 'original input.cjs');
        const output = join(root, 'bundles', 'protected bundle.cjs');
        const mapFile = join(root, 'source maps', 'the map #1.json');
        await writeFile(input, source);
        const result = runCli([input, '-o', output, '--preset', 'light', '--target', 'node',
            '--sourcemap', 'true', '--sourcemap-file', mapFile]);
        assert.equal(result.status, 0, result.stderr);
        const code = await readFile(output, 'utf8');
        const url = code.match(/sourceMappingURL=(\S+)/)?.[1];
        assert.ok(url);
        assert.match(url, /%20/);
        assert.match(url, /%23/);
        assert.equal(fileURLToPath(new URL(url, pathToFileURL(output))), mapFile);
        const map = JSON.parse(await readFile(mapFile, 'utf8'));
        assert.deepEqual(map.sources, [relative(dirname(mapFile), input)]);
        assert.equal(map.file, 'protected bundle.cjs');
        assertOriginalLocation(output, map, input);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI directory maps are adjacent to each output and retain nested source locations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-directory-maps-'));
    try {
        const input = join(root, 'source');
        const output = join(root, 'protected');
        await mkdir(join(input, 'nested'), { recursive: true });
        await writeFile(join(input, 'one.cjs'), source);
        await writeFile(join(input, 'nested', 'two.cjs'), source);
        const result = runCli([input, '-o', output, '--preset', 'light', '--target', 'node', '--sourcemap', 'hidden']);
        assert.equal(result.status, 0, result.stderr);
        for (const name of ['one.cjs', 'nested/two.cjs']) {
            const mapFile = join(output, `${name}.map`);
            const map = JSON.parse(await readFile(mapFile, 'utf8'));
            assert.equal(map.file, basename(name));
            assert.deepEqual(map.sources, [relative(dirname(mapFile), join(input, name))]);
            assert.doesNotMatch(await readFile(join(output, name), 'utf8'), /sourceMappingURL/);
            assertOriginalLocation(join(output, name), map, join(input, name));
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI stdin supports inline maps and explicit external maps without ambiguous default paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-stdin-maps-'));
    try {
        const inline = runCli(['-', '-o', '-', '--preset', 'light', '--sourcemap', 'inline'], 'console.log(6 * 7);');
        assert.equal(inline.status, 0, inline.stderr);
        const encoded = inline.stdout.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
        assert.ok(encoded);
        const map = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'));
        assert.deepEqual(map.sourcesContent, ['console.log(6 * 7);']);
        const runtime = spawnSync(process.execPath, ['--input-type=commonjs'], {
            input: inline.stdout, encoding: 'utf8', timeout: 5000
        });
        assert.equal(runtime.status, 0, runtime.stderr);
        assert.equal(runtime.stdout.trim(), '42');
        for (const mode of ['true', 'hidden']) {
            const missing = runCli(['-', '-o', '-', '--sourcemap', mode], 'console.log(42);');
            assert.notEqual(missing.status, 0);
            assert.match(missing.stderr, /sourcemap-file/);
            assert.equal(missing.stdout, '');
            const mapFile = join(root, `${mode} map.json`);
            const result = runCli(['-', '-o', '-', '--preset', 'light', '--sourcemap', mode,
                '--sourcemap-file', mapFile], 'console.log(42);');
            assert.equal(result.status, 0, result.stderr);
            const payload = JSON.parse(await readFile(mapFile, 'utf8'));
            assert.deepEqual(payload.sourcesContent, ['console.log(42);']);
            if (mode === 'hidden') assert.doesNotMatch(result.stdout, /sourceMappingURL/);
            else assert.equal(fileURLToPath(new URL(result.stdout.match(/sourceMappingURL=(\S+)/)[1],
                pathToFileURL(`${process.cwd()}/stdin.js`))), mapFile);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI source-map destinations share input and output collision protections before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-unsafe-maps-'));
    try {
        const input = join(root, 'input.cjs');
        const output = join(root, 'protected.cjs');
        const report = join(root, 'report.json');
        const mapSymlink = join(root, 'input-symlink.map');
        const mapHardlink = join(root, 'input-hardlink.map');
        await writeFile(input, source);
        await symlink(input, mapSymlink);
        await link(input, mapHardlink);
        const notDirectory = join(root, 'not-a-directory');
        await writeFile(notDirectory, 'unchanged parent');
        for (const mapFile of [input, output, report, mapSymlink, mapHardlink, root, join(notDirectory, 'child.map')]) {
            const args = [input, '-o', output, '--preset', 'light', '--sourcemap', 'true',
                '--sourcemap-file', mapFile, '--force'];
            if (mapFile === report) args.push('--report', report);
            const result = runCli(args);
            assert.notEqual(result.status, 0, `unsafe map path must fail: ${mapFile}`);
            assert.equal(await readFile(input, 'utf8'), source);
            await assert.rejects(readFile(output), { code: 'ENOENT' });
        }

        // An existing generated-map alias to a different planned output must
        // be found before either output or map is replaced.
        const directory = join(root, 'sources');
        const protectedDirectory = join(root, 'outputs');
        await mkdir(directory);
        await mkdir(protectedDirectory);
        await writeFile(join(directory, 'one.cjs'), source);
        await writeFile(join(directory, 'two.cjs'), source);
        await writeFile(join(protectedDirectory, 'two.cjs'), 'existing output');
        await link(join(protectedDirectory, 'two.cjs'), join(protectedDirectory, 'one.cjs.map'));
        const alias = runCli([directory, '-o', protectedDirectory, '--sourcemap', 'hidden', '--force']);
        assert.notEqual(alias.status, 0);
        assert.equal(await readFile(join(protectedDirectory, 'two.cjs'), 'utf8'), 'existing output');
        await assert.rejects(readFile(join(protectedDirectory, 'one.cjs')), { code: 'ENOENT' });

        const blockedMap = `${output}.map`;
        await writeFile(blockedMap, 'existing map');
        const existing = runCli([input, '-o', output, '--sourcemap', 'true']);
        assert.notEqual(existing.status, 0);
        await assert.rejects(readFile(output), { code: 'ENOENT' });
        assert.equal(await readFile(blockedMap, 'utf8'), 'existing map');
        const forced = runCli([input, '-o', output, '--preset', 'light', '--sourcemap', 'true', '--force']);
        assert.equal(forced.status, 0, forced.stderr);
        assert.equal(JSON.parse(await readFile(blockedMap, 'utf8')).version, 3);
        assert.equal(await readFile(input, 'utf8'), source);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI rejects unsupported source-map modes and incompatible map paths before output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-bad-map-options-'));
    try {
        const input = join(root, 'input.cjs');
        const directory = join(root, 'sources');
        const output = join(root, 'output.cjs');
        const mapFile = join(root, 'output.map');
        await writeFile(input, source);
        await mkdir(directory);
        await writeFile(join(directory, 'input.cjs'), source);
        for (const args of [
            [input, '--sourcemap', 'external'],
            [input, '--sourcemap-file', mapFile],
            [input, '--sourcemap', 'inline', '--sourcemap-file', mapFile],
            [input, '--sourcemap', 'false', '--sourcemap-file', mapFile],
            [directory, '--sourcemap', 'true', '--sourcemap-file', mapFile]
        ]) {
            const result = runCli([...args, '-o', output]);
            assert.notEqual(result.status, 0, JSON.stringify(args));
            assert.match(result.stderr, /sourcemap/);
            await assert.rejects(readFile(output), { code: 'ENOENT' });
        }
        assert.deepEqual((await readdir(root)).sort(), ['input.cjs', 'sources']);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
