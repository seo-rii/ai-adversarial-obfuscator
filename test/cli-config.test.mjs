import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve('bin/ai-obfuscate.mjs');

function runCli(args, { input, cwd = resolve('.') } = {}) {
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd, input, encoding: 'utf8', timeout: 30000
    });
}

test('CLI JSON config uses config-relative paths and explicit CLI values take precedence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-config-precedence-'));
    try {
        const configDirectory = join(root, 'configuration');
        const caller = join(root, 'caller');
        await mkdir(configDirectory);
        await mkdir(caller);
        await writeFile(join(root, 'source.cjs'), 'module.exports = 41;');
        await writeFile(join(caller, 'override.cjs'), 'module.exports = 42;');
        const configFile = join(configDirectory, 'options.json');
        const config = {
            input: '../source.cjs', output: '../configured/output.cjs', report: '../configured-report.json',
            sourcemap: 'hidden', sourcemapFile: '../maps/configured.map',
            preset: 'balanced', seed: 19, target: 'node', terms: ['ConfigTopic'], mode: 'topic', adversarial: true
        };
        await writeFile(configFile, JSON.stringify(config));
        const configured = runCli(['--config', configFile], { cwd: caller });
        assert.equal(configured.status, 0, configured.stderr);
        const report = JSON.parse(await readFile(join(root, 'configured-report.json'), 'utf8'))[0];
        assert.equal(report.preset, 'balanced');
        assert.equal(report.seed, 19);
        assert.equal(report.mode, 'topic');
        assert.equal(report.adversarial, true);
        assert.match(await readFile(join(root, 'configured/output.cjs'), 'utf8'), /ConfigTopic/);
        const map = JSON.parse(await readFile(join(root, 'maps/configured.map'), 'utf8'));
        assert.deepEqual(map.sources, ['../source.cjs']);

        const overridden = runCli(['override.cjs', '--config', configFile, '-o', 'cli-output.cjs',
            '--report', 'cli-report.json', '--sourcemap-file', 'cli.map', '--preset', 'light', '--seed', '29',
            '--mode', 'refusal', '--terms', 'CliTopic', '--no-adversarial'], { cwd: caller });
        assert.equal(overridden.status, 0, overridden.stderr);
        const cliReport = JSON.parse(await readFile(join(caller, 'cli-report.json'), 'utf8'))[0];
        assert.equal(cliReport.preset, 'light');
        assert.equal(cliReport.seed, 29);
        assert.equal(cliReport.adversarial, false);
        const code = await readFile(join(caller, 'cli-output.cjs'), 'utf8');
        assert.doesNotMatch(code, /AI_ANALYSIS_DECOY|ConfigTopic|CliTopic/);
        assert.deepEqual(JSON.parse(await readFile(join(caller, 'cli.map'), 'utf8')).sources, ['override.cjs']);
        const executed = spawnSync(process.execPath, ['-e', 'console.log(require("./cli-output.cjs"))'], {
            cwd: caller, encoding: 'utf8', timeout: 5000
        });
        assert.equal(executed.status, 0, executed.stderr);
        assert.equal(executed.stdout.trim(), '42');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI preserves configured adversarial=false and accepts boolean source-map settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-config-booleans-'));
    try {
        await writeFile(join(root, 'input.js'), 'export const answer = 42;');
        const config = join(root, 'config.json');
        await writeFile(config, JSON.stringify({
            input: 'input.js', output: 'output.js', report: 'report.json',
            preset: 'light', adversarial: false, sourcemap: true
        }));
        const result = runCli(['--config', config]);
        assert.equal(result.status, 0, result.stderr);
        const code = await readFile(join(root, 'output.js'), 'utf8');
        assert.doesNotMatch(code, /AI_ANALYSIS_DECOY/);
        assert.match(code, /sourceMappingURL=output\.js\.map/);
        assert.equal(JSON.parse(await readFile(join(root, 'report.json'), 'utf8'))[0].adversarial, false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI globs filter input-relative POSIX paths, with exclusion and explicit CLI precedence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-config-globs-'));
    try {
        const input = join(root, 'source');
        await mkdir(join(input, 'nested'), { recursive: true });
        for (const name of ['app.js', '.hidden.js', 'nested/module.mjs', 'nested/skip.js', 'other.cjs']) {
            await writeFile(join(input, name), 'export const value = 7;');
        }
        const config = join(root, 'config.json');
        await writeFile(config, JSON.stringify({
            input: 'source', output: 'protected', preset: 'light',
            include: ['**/*.js', '**/*.mjs'], exclude: '**/skip.*'
        }));
        const filtered = runCli(['--config', config]);
        assert.equal(filtered.status, 0, filtered.stderr);
        const files = (await readdir(join(root, 'protected'), { recursive: true }))
            .filter(name => /\.(?:js|mjs|cjs)$/.test(name)).sort();
        assert.deepEqual(files, ['.hidden.js', 'app.js', 'nested/module.mjs']);

        const planned = runCli(['--config', config, '-o', join(root, 'planned'), '--include', 'nested/**',
            '--include', '*.cjs', '--exclude', '**/module.*', '--dry-run']);
        assert.equal(planned.status, 0, planned.stderr);
        const plan = JSON.parse(planned.stdout);
        assert.deepEqual(plan.files.map(file => file.input.slice(input.length + 1)).sort(), ['nested/skip.js', 'other.cjs']);
        await assert.rejects(readdir(join(root, 'planned')), { code: 'ENOENT' });

        const single = runCli([join(input, 'app.js'), '-o', join(root, 'single.js'), '--exclude', 'app.js', '--dry-run']);
        assert.equal(single.status, 0, single.stderr);
        assert.deepEqual(JSON.parse(single.stdout).files, []);
        const invalid = runCli([join(input, 'app.js'), '-o', join(root, 'single.js'), '--exclude', '**', '--seed', '0', '--dry-run']);
        assert.notEqual(invalid.status, 0, 'options must still be validated with no selected files');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI dry-run and check validate without creating outputs, maps, reports, or directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-planning-'));
    try {
        const input = join(root, 'input.js');
        const output = join(root, 'new-output', 'app.js');
        const report = join(root, 'new-reports', 'report.json');
        await writeFile(input, 'function broken( {');
        const args = [input, '-o', output, '--report', report, '--sourcemap', 'true', '--preset', 'light'];
        const dryRun = runCli([...args, '--dry-run']);
        assert.equal(dryRun.status, 0, dryRun.stderr);
        assert.deepEqual(JSON.parse(dryRun.stdout), {
            mode: 'dry-run', files: [{ input, output, sourcemapFile: `${output}.map` }], report
        });
        const invalid = runCli([...args, '--check']);
        assert.notEqual(invalid.status, 0, 'check must parse and transform selected inputs');
        assert.equal(invalid.stdout, '');
        await writeFile(input, 'throw new Error("check must not execute source");');
        const checked = runCli([...args, '--check']);
        assert.equal(checked.status, 0, checked.stderr);
        assert.equal(JSON.parse(checked.stdout).mode, 'check');
        assert.deepEqual((await readdir(root)).sort(), ['input.js']);

        await mkdir(join(root, 'new-output'));
        await writeFile(output, 'existing output');
        const exists = runCli([...args, '--dry-run']);
        assert.notEqual(exists.status, 0);
        assert.match(exists.stderr, /EEXIST/);
        const forcedPlan = runCli([...args, '--dry-run', '--force']);
        assert.equal(forcedPlan.status, 0, forcedPlan.stderr);
        assert.equal(await readFile(output, 'utf8'), 'existing output');
        await assert.rejects(readFile(`${output}.map`), { code: 'ENOENT' });
        await assert.rejects(readdir(join(root, 'new-reports')), { code: 'ENOENT' });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI rejects malformed, unknown, and incorrectly typed JSON configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-invalid-config-'));
    try {
        const input = join(root, 'input.js');
        const output = join(root, 'output.js');
        const configFile = join(root, 'config.json');
        await writeFile(input, 'export const answer = 42;');
        const invalid = [
            '{broken JSON', '[]', 'null',
            JSON.stringify({ unknown: true }),
            JSON.stringify({ force: true }),
            JSON.stringify({ seed: '5' }),
            JSON.stringify({ seed: null }),
            JSON.stringify({ adversarial: 'false' }),
            JSON.stringify({ terms: 'OneTopic' }),
            JSON.stringify({ output: 7 }),
            JSON.stringify({ include: [true] }),
            JSON.stringify({ sourcemap: 'external' })
        ];
        for (const contents of invalid) {
            await writeFile(configFile, contents);
            const result = runCli([input, '-o', output, '--config', configFile]);
            assert.notEqual(result.status, 0, contents);
            await assert.rejects(readFile(output), { code: 'ENOENT' });
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI never replaces its explicit configuration through outputs, maps, reports, or aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-protected-config-'));
    try {
        const input = join(root, 'input.js');
        const output = join(root, 'protected.js');
        const configFile = join(root, 'config.json');
        const alias = join(root, 'config-alias.json');
        const contents = JSON.stringify({ preset: 'light' });
        await writeFile(input, 'export const answer = 42;');
        await writeFile(configFile, contents);
        await link(configFile, alias);
        for (const args of [
            [input, '-o', configFile],
            [input, '-o', alias],
            [input, '-o', output, '--report', configFile],
            [input, '-o', output, '--sourcemap', 'true', '--sourcemap-file', configFile],
            ['-', '-o', '-', '--report', configFile]
        ]) {
            const result = runCli([...args, '--config', configFile, '--force'], { input: 'console.log(42);' });
            assert.notEqual(result.status, 0, JSON.stringify(args));
            assert.match(result.stderr, /configuration file/);
            assert.equal(await readFile(configFile, 'utf8'), contents);
            assert.equal(await readFile(alias, 'utf8'), contents);
            await assert.rejects(readFile(output), { code: 'ENOENT' });
            assert.equal(result.stdout, '');
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI planning commands reject conflicting modes and stdin, and config is explicit only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-cli-explicit-config-'));
    try {
        await writeFile(join(root, 'input.js'), 'export const answer = 42;');
        await writeFile(join(root, 'ai-obfuscate.config.json'), '{malformed and must not be loaded');
        const defaultRun = runCli(['input.js', '-o', 'output.js', '--preset', 'light'], { cwd: root });
        assert.equal(defaultRun.status, 0, defaultRun.stderr);
        for (const args of [
            ['input.js', '--dry-run', '--check'],
            ['-', '-o', '-', '--dry-run'],
            ['-', '-o', '-', '--check']
        ]) {
            const result = runCli(args, { cwd: root, input: 'console.log(42);' });
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /mutually exclusive|stdin/);
            assert.equal(result.stdout, '');
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
