import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obfuscateSource, obfuscateWithReport, normalizeOptions } from '../src/core.mjs';

async function importSource(source) {
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const sample = `
export function compute(a, b) {
    let result = 0;
    for (let i = 0; i < a; i++) result += b;
    return result;
}
export function classify(n) {
    if (n < 0) return 'negative';
    if (n === 0) return 'zero';
    return 'positive';
}
`;

test('all presets preserve ESM exports and behavior', async () => {
    const original = await importSource(sample);
    for (const preset of ['light', 'balanced', 'strong']) {
        const { code, report } = obfuscateWithReport(sample, { preset, seed: 55 });
        const transformed = await importSource(code);
        for (let a = 0; a < 9; a++) {
            for (let b = -4; b < 5; b++) {
                assert.equal(transformed.compute(a, b), original.compute(a, b));
            }
        }
        for (const n of [-20, -1, 0, 1, 45]) {
            assert.equal(transformed.classify(n), original.classify(n));
        }
        assert.equal(report.preset, preset);
        assert.equal(report.evaluation, 'not-performed');
        assert.match(code, /BioWeaponPayload/);
        assert.match(code, /if \(false\)/);
    }
});

test('deterministic seed produces stable output', () => {
    const x = obfuscateSource(sample, { seed: 42 });
    const y = obfuscateSource(sample, { seed: 42 });
    assert.equal(x, y);
    assert.notEqual(x, obfuscateSource(sample, { seed: 43 }));
});

test('adversarial markers preserve strict script directives', () => {
    const original = `"use strict";
        globalThis.strictThis = (function () { return this; })() === undefined;
        try { accidentalGlobal = 1; }
        catch (error) { globalThis.assignmentError = error.name; }
    `;
    for (const preset of ['light', 'balanced', 'strong']) {
        const code = obfuscateSource(original, { preset, seed: 5, target: 'node' });
        const context = {};
        runInNewContext(code, context);
        assert.equal(context.strictThis, true, preset);
        assert.equal(context.assignmentError, 'ReferenceError', preset);
        assert.equal(context.accidentalGlobal, undefined, preset);
        assert.match(code, /AI_ANALYSIS_DECOY/);
    }
});

test('adversarial output keeps hashbang scripts executable by Node', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-core-hashbang-'));
    try {
        const original = '#!/usr/bin/env node\n"use strict";\nconsole.log((function () { return this; })() === undefined ? "strict" : "loose");';
        for (const preset of ['light', 'balanced', 'strong']) {
            const code = obfuscateSource(original, { preset, seed: 5, target: 'node' });
            assert.ok(code.startsWith('#!/usr/bin/env node\n'), preset);
            const output = join(root, `${preset}.cjs`);
            await writeFile(output, code);
            const result = spawnSync(process.execPath, [output], { encoding: 'utf8', timeout: 5000 });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout.trim(), 'strict', preset);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('source maps locate original errors with and without appended adversarial markers', async () => {
    const original = 'export function explode() {\n    throw new Error("mapped-core-error");\n}\n';
    for (const adversarial of [true, false]) {
        const { code, map } = obfuscateWithReport(original, {
            preset: 'light', seed: 10, adversarial, sourceMap: true
        }, { fileName: 'original.mjs' });
        assert.equal(map.version, 3);
        assert.deepEqual(map.sources, ['original.mjs']);
        assert.deepEqual(map.sourcesContent, [original]);
        assert.doesNotMatch(code, /sourceMappingURL/);
        const transformed = await importSource(code);
        let failure;
        try {
            transformed.explode();
        } catch (error) {
            failure = error;
        }
        assert.equal(failure.message, 'mapped-core-error');
        const frame = failure.stack.split('\n')[1].match(/:(\d+):(\d+)\)$/);
        assert.ok(frame, failure.stack);
        const entry = new SourceMap(map).findEntry(Number(frame[1]) - 1, Number(frame[2]) - 1);
        assert.equal(entry.originalSource, 'original.mjs');
        assert.equal(entry.originalLine, 1);
    }
    assert.equal(obfuscateWithReport(original).map, null);
    assert.throws(() => normalizeOptions({ sourceMap: 'inline' }), /sourceMap must be a boolean/);
});

test('standard-only mode omits adversarial material', async () => {
    const code = obfuscateSource(sample, { adversarial: false, seed: 18 });
    const imported = await importSource(code);
    assert.equal(imported.compute(3, 4), 12);
    assert.doesNotMatch(code, /AI_ANALYSIS_DECOY|BioWeaponPayload/);
});

test('reject malformed options and sanitize injected comment syntax', async () => {
    assert.throws(() => normalizeOptions({ preset: 'extreme' }), /unknown preset/);
    assert.throws(() => normalizeOptions({ seed: 0 }), /positive safe integer/);
    assert.throws(() => normalizeOptions({ terms: [] }), /1 to 16/);
    const code = obfuscateSource(sample, { terms: ['abc*/\nalert(1)'], seed: 1 });
    assert.doesNotMatch(code, /\*\/\nalert\(1\)/);
    assert.equal((await importSource(code)).compute(2, 8), 16);
});

test('balanced preset keeps closures, classes, async functions and optional chaining usable', async () => {
    const advanced = `
        export class Counter {
            constructor(step = 2) { this.count = 0; this.step = step; }
            increment() { this.count += this.step; return this.count; }
        }
        export function makeAdder(start) {
            let state = start;
            return (value) => (state += value);
        }
        export async function lookup(value) {
            return Promise.resolve({ items: [{ name: value }] })
                .then(x => x.items?.[0]?.name ?? 'missing');
        }
    `;
    const original = await importSource(advanced);
    const changed = await importSource(obfuscateSource(advanced, { preset: 'balanced', seed: 900 }));
    const a = new original.Counter(3);
    const b = new changed.Counter(3);
    assert.deepEqual([a.increment(), a.increment()], [b.increment(), b.increment()]);
    const c = original.makeAdder(10);
    const d = changed.makeAdder(10);
    assert.deepEqual([c(1), c(4), c(-2)], [d(1), d(4), d(-2)]);
    assert.equal(await changed.lookup('safe'), await original.lookup('safe'));
});
