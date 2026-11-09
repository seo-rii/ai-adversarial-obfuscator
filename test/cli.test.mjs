import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
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
