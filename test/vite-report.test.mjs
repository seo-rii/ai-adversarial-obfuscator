import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, createLogger } from 'vite';
import aiAdversarialObfuscator from '../src/vite.mjs';

const fixtureRoot = resolve('fixtures/vite');
const reportName = 'ai-obfuscation-report.json';

async function buildFixture(output, pluginOptions = {}, buildOptions = {}, extraConfig = {}) {
    return build({
        configFile: false,
        root: fixtureRoot,
        base: './',
        logLevel: 'silent',
        plugins: [aiAdversarialObfuscator({ preset: 'light', seed: 19, ...pluginOptions })],
        ...extraConfig,
        build: {
            outDir: output,
            emptyOutDir: true,
            minify: true,
            sourcemap: false,
            modulePreload: { polyfill: false },
            ...buildOptions
        }
    });
}

function measure(code) {
    return {
        bytes: code.length,
        gzipBytes: gzipSync(code).length,
        brotliBytes: brotliCompressSync(code).length,
        sha256: createHash('sha256').update(code).digest('hex')
    };
}

test('Vite reports final inline-map bytes, compressed sizes, hashes, and skipped output chunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-final-report-'));
    try {
        await buildFixture(root, { exclude: /lazy/ }, { sourcemap: 'inline' });
        const report = JSON.parse(await readFile(join(root, reportName), 'utf8'));
        assert.equal(report.schemaVersion, 2);
        assert.equal(report.chunks.length, 1, 'the legacy chunks list contains only transformed chunks');
        assert.equal(report.files.length, 2, 'the final files list also includes skipped JavaScript');
        const sums = { bytes: 0, gzipBytes: 0, brotliBytes: 0, mapBytes: 0 };
        for (const file of report.files) {
            assert.equal(typeof file.fileName, 'string');
            const code = await readFile(join(root, file.fileName));
            const expected = measure(code);
            for (const [metric, actual] of Object.entries(expected)) assert.equal(file[metric], actual, `${file.fileName}: ${metric}`);
            const inline = code.toString('utf8').match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
            assert.ok(inline, file.fileName);
            assert.equal(file.mapBytes, Buffer.from(inline[1], 'base64').length);
            const lazy = file.fileName.split('/').at(-1).startsWith('lazy-');
            assert.equal(file.obfuscated, !lazy);
            if (lazy) assert.doesNotMatch(code.toString('utf8'), /AI_ANALYSIS_DECOY/);
            else assert.match(code.toString('utf8'), /AI_ANALYSIS_DECOY/);
            for (const metric of Object.keys(sums)) sums[metric] += file[metric];
        }
        for (const [metric, value] of Object.entries(sums)) assert.equal(report.totals[metric], value, metric);
        assert.ok(report.totals.beforeBytes > 0);
        assert.ok(Math.abs(report.totals.growthRatio - report.totals.bytes / report.totals.beforeBytes) < 1e-8);
        assert.equal(report.budgetViolations.length, 0);
        const transformed = report.chunks[0];
        assert.equal(transformed.chunk, 'index');
        assert.equal(transformed.evaluation, 'not-performed');
        assert.ok(Number.isFinite(transformed.transformMs) && transformed.transformMs >= 0);
        assert.equal(report.totals.transformMs, transformed.transformMs);
        const final = report.files.find(file => file.obfuscated);
        for (const field of ['fileName', 'bytes', 'gzipBytes', 'brotliBytes', 'sha256', 'mapBytes']) {
            assert.equal(transformed.emitted[field], final[field], field);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite reports custom external map asset sizes separately from final JavaScript bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-external-map-report-'));
    try {
        await buildFixture(root, {}, {
            sourcemap: true,
            rolldownOptions: { output: { sourcemapFileNames: 'maps/[name]-[hash:8].map' } }
        });
        const report = JSON.parse(await readFile(join(root, reportName), 'utf8'));
        const actualMaps = await readdir(join(root, 'maps'));
        assert.equal(actualMaps.length, 2);
        let mapBytes = 0;
        for (const file of report.files) {
            const code = await readFile(join(root, file.fileName));
            assert.equal(file.bytes, code.length);
            const name = file.fileName.split('/').at(-1).split('-')[0];
            const mapName = actualMaps.find(map => map.startsWith(`${name}-`));
            assert.ok(mapName, file.fileName);
            const contents = await readFile(join(root, 'maps', mapName));
            assert.equal(file.mapBytes, contents.length);
            mapBytes += contents.length;
        }
        assert.equal(report.totals.mapBytes, mapBytes);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite budgets accept exact aggregate limits and reject exceeded limits before output is written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-report-budgets-'));
    try {
        await buildFixture(join(root, 'reference'));
        const { totals } = JSON.parse(await readFile(join(root, 'reference', reportName), 'utf8'));
        const limits = {
            maxBytes: totals.bytes,
            maxGzipBytes: totals.gzipBytes,
            maxBrotliBytes: totals.brotliBytes,
            maxGrowthRatio: totals.growthRatio
        };
        await buildFixture(join(root, 'exact'), { budgets: limits });
        const exact = JSON.parse(await readFile(join(root, 'exact', reportName), 'utf8'));
        assert.deepEqual(exact.budgetViolations, []);
        for (const [name, limit] of Object.entries(limits)) {
            const output = join(root, name);
            const exceeded = { [name]: name === 'maxGrowthRatio' ? limit / 2 : limit - 1 };
            await assert.rejects(buildFixture(output, { budgets: exceeded }), /budget/i, name);
            const files = await readdir(output, { recursive: true }).catch(error => {
                if (error.code === 'ENOENT') return [];
                throw error;
            });
            assert.ok(!files.some(file => /\.(?:js|json|map)$/.test(file)), `${name} must fail before writing artifacts`);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite warning budgets emit measured violations and budgets still apply when reports are disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-budget-warning-'));
    const warnings = [];
    const logger = createLogger('silent');
    logger.warn = message => warnings.push(message);
    logger.warnOnce = message => warnings.push(message);
    try {
        const output = join(root, 'warning');
        await buildFixture(output, { budgets: { maxBytes: 1, onExceeded: 'warn' } }, {}, { customLogger: logger, logLevel: 'warn' });
        const report = JSON.parse(await readFile(join(output, reportName), 'utf8'));
        assert.equal(report.budgetViolations.length, 1);
        const violation = report.budgetViolations[0];
        assert.equal(violation.metric, 'bytes');
        assert.equal(violation.actual, report.totals.bytes);
        assert.equal(violation.limit, 1);
        assert.ok(warnings.some(message => /budget/i.test(message)), JSON.stringify(warnings));
        await assert.rejects(buildFixture(join(root, 'disabled'), {
            reportFile: false,
            budgets: { maxBytes: 1 }
        }), /budget/i);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vite rejects invalid budget configuration', () => {
    for (const budgets of [
        null,
        [],
        { maxBytes: -1 },
        { maxGzipBytes: 1.5 },
        { maxBrotliBytes: Infinity },
        { maxGrowthRatio: 0 },
        { maxGrowthRatio: NaN },
        { onExceeded: 'ignore' },
        { unknownLimit: 10 }
    ]) {
        assert.throws(() => aiAdversarialObfuscator({ budgets }), /budget|limit|onExceeded/i);
    }
});
