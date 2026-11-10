import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = resolve('bin/ai-obfuscate.mjs');

function runCli(args, input) {
    return spawnSync(process.execPath, [CLI, ...args], {
        input,
        encoding: 'utf8',
        cwd: resolve('.'),
        timeout: 30000
    });
}

test('CLI file input, report, overwrite protection, and actual Node execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiob-cli-'));
    try {
        const input = join(dir, 'input.cjs');
        const output = join(dir, 'out.cjs');
        const report = join(dir, 'report.json');
        await writeFile(input, 'module.exports = function(a, b) { return `${a}:${b}`; };');
        const result = runCli([input, '-o', output, '--target', 'node', '--report', report, '--seed', '50']);
        assert.equal(result.status, 0, result.stderr);
        assert.match(await readFile(output, 'utf8'), /AI_ANALYSIS_DECOY/);
        assert.equal(JSON.parse(await readFile(report, 'utf8'))[0].evaluation, 'not-performed');
        const execution = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(output)})(6, 9))`], {
            encoding: 'utf8', timeout: 5000
        });
        assert.equal(execution.status, 0, execution.stderr);
        assert.equal(execution.stdout.trim(), '6:9');

        const again = runCli([input, '-o', output, '--target', 'node']);
        assert.notEqual(again.status, 0);
        assert.match(again.stderr, /EEXIST/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('CLI directory processing and stdin/stdout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiob-dir-'));
    try {
        const input = join(dir, 'source');
        const output = join(dir, 'protected');
        await mkdir(join(input, 'sub'), { recursive: true });
        await writeFile(join(input, 'one.js'), 'globalThis.__ONE__ = 1 + 2;');
        await writeFile(join(input, 'sub', 'two.mjs'), 'export const value = 5 * 6;');
        await writeFile(join(input, 'skip.md'), 'do not transform');
        const result = runCli([input, '-o', output, '--preset', 'light']);
        assert.equal(result.status, 0, result.stderr);
        assert.equal((await readdir(output)).length, 2);
        assert.match(await readFile(join(output, 'sub', 'two.mjs'), 'utf8'), /AI_ANALYSIS_DECOY/);

        const piped = runCli(['-', '-o', '-', '--preset', 'light'], 'globalThis.__STDIN__ = 123;');
        assert.equal(piped.status, 0, piped.stderr);
        assert.match(piped.stdout, /AI_ANALYSIS_DECOY/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('CLI prevents overlapping input/output directories and rejects bad flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiob-safety-'));
    try {
        const input = join(dir, 'source');
        await mkdir(input);
        await writeFile(join(input, 'app.js'), 'console.log(1);');
        const nested = runCli([input, '-o', join(input, 'dist')]);
        assert.notEqual(nested.status, 0);
        assert.match(nested.stderr, /may not overlap/);
        const unknown = runCli([join(input, 'app.js'), '--preset', 'super-strong']);
        assert.notEqual(unknown.status, 0);
        assert.match(unknown.stderr, /Unknown preset/);
        const reportOverlap = runCli([join(input, 'app.js'), '-o', join(dir, 'out.js'), '--report', join(input, 'app.js'), '--force']);
        assert.notEqual(reportOverlap.status, 0);
        assert.match(reportOverlap.stderr, /Report path must not overlap/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('CLI refuses output and report file aliases without changing inputs under --force', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiob-file-aliases-'));
    try {
        for (const kind of ['symlink', 'hardlink']) {
            for (const destination of ['output', 'report']) {
                const input = join(dir, `${kind}-${destination}-input.js`);
                const alias = join(dir, `${kind}-${destination}-alias.js`);
                const output = destination === 'output' ? alias : join(dir, `${kind}-protected.js`);
                const original = 'export const original = 123;';
                await writeFile(input, original);
                await (kind === 'symlink' ? symlink(input, alias) : link(input, alias));
                const result = runCli([input, '-o', output, '--preset', 'light', '--force',
                    ...(destination === 'report' ? ['--report', alias] : [])]);
                assert.notEqual(result.status, 0, `${kind} ${destination} alias must be rejected`);
                assert.equal(await readFile(input, 'utf8'), original);
                if (destination === 'report') await assert.rejects(readFile(output), { code: 'ENOENT' });
            }
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('CLI checks canonical directory paths and report collisions before writing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiob-directory-aliases-'));
    try {
        const input = join(dir, 'source');
        const alias = join(dir, 'source-alias');
        const output = join(dir, 'protected');
        const original = 'export const original = 7;';
        await mkdir(join(input, 'sub'), { recursive: true });
        await writeFile(join(input, 'app.js'), original);
        await writeFile(join(input, 'sub', 'nested.js'), original);
        await symlink(input, alias, 'dir');

        for (const args of [
            [input, '-o', alias],
            [input, '-o', join(alias, 'nested-output')],
            [join(alias, 'app.js'), '-o', join(input, 'app.js')],
            [input, '-o', output, '--report', join(output, 'app.js')]
        ]) {
            const result = runCli([...args, '--preset', 'light', '--force']);
            assert.notEqual(result.status, 0, result.stderr);
            assert.equal(await readFile(join(input, 'app.js'), 'utf8'), original);
            assert.equal(await readFile(join(input, 'sub', 'nested.js'), 'utf8'), original);
        }
        await assert.rejects(readFile(join(output, 'app.js')), { code: 'ENOENT' });

        // An existing output subdirectory can hide an alias into the input tree.
        await mkdir(output);
        await symlink(join(input, 'sub'), join(output, 'sub'), 'dir');
        const nested = runCli([input, '-o', output, '--preset', 'light', '--force']);
        assert.notEqual(nested.status, 0);
        assert.equal(await readFile(join(input, 'sub', 'nested.js'), 'utf8'), original);
        await assert.rejects(readFile(join(output, 'app.js')), { code: 'ENOENT' });

        const reportAlias = join(dir, 'output-alias');
        await symlink(output, reportAlias, 'dir');
        const report = runCli([join(input, 'app.js'), '-o', join(output, 'app.js'),
            '--report', join(reportAlias, 'app.js'), '--preset', 'light', '--force']);
        assert.notEqual(report.status, 0);
        assert.equal(await readFile(join(input, 'app.js'), 'utf8'), original);
        await assert.rejects(readFile(join(output, 'app.js')), { code: 'ENOENT' });

        const existingOutput = join(output, 'app.js');
        const hardlinkedReport = join(dir, 'output-report-hardlink.json');
        await writeFile(existingOutput, 'old protected output');
        await link(existingOutput, hardlinkedReport);
        const sharedOutput = runCli([join(input, 'app.js'), '-o', existingOutput,
            '--report', hardlinkedReport, '--preset', 'light', '--force']);
        assert.notEqual(sharedOutput.status, 0);
        assert.equal(await readFile(existingOutput, 'utf8'), 'old protected output');
        assert.equal(await readFile(join(input, 'app.js'), 'utf8'), original);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('CLI preserves normal forced writes and safely replaces stdin report hardlinks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiob-safe-force-'));
    try {
        const input = join(dir, 'input.js');
        const output = join(dir, 'nested', 'output.js');
        const report = join(dir, 'report.json');
        const original = 'export const original = 42;';
        await writeFile(input, original);
        await mkdir(join(dir, 'nested'));
        await writeFile(output, 'old output');
        await writeFile(report, 'old report');
        const result = runCli([input, '-o', output, '--report', report, '--preset', 'light', '--force']);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await readFile(input, 'utf8'), original);
        assert.match(await readFile(output, 'utf8'), /AI_ANALYSIS_DECOY/);
        assert.equal(JSON.parse(await readFile(report, 'utf8')).length, 1);

        const hardlinkedReport = join(dir, 'hardlinked-report.json');
        await link(input, hardlinkedReport);
        const stdin = runCli(['-', '-o', '-', '--report', hardlinkedReport, '--preset', 'light', '--force'], original);
        assert.equal(stdin.status, 0, stdin.stderr);
        assert.equal(await readFile(input, 'utf8'), original);
        assert.equal(JSON.parse(await readFile(hardlinkedReport, 'utf8')).length, 1);

        const symlinkedReport = join(dir, 'symlinked-report.json');
        await symlink(input, symlinkedReport);
        const symlinkResult = runCli(['-', '-o', '-', '--report', symlinkedReport, '--preset', 'light', '--force'], original);
        assert.notEqual(symlinkResult.status, 0);
        assert.equal(await readFile(input, 'utf8'), original);

        const realOutput = join(dir, 'real-output');
        const outputAlias = join(dir, 'safe-output-alias');
        await mkdir(realOutput);
        await symlink(realOutput, outputAlias, 'dir');
        const aliasedParent = runCli([input, '-o', join(outputAlias, 'app.js'), '--preset', 'light', '--force']);
        assert.equal(aliasedParent.status, 0, aliasedParent.stderr);
        assert.match(await readFile(join(realOutput, 'app.js'), 'utf8'), /AI_ANALYSIS_DECOY/);
        assert.equal(await readFile(input, 'utf8'), original);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
