#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, rename, rm } from 'node:fs/promises';
import { obfuscateWithReport, PRESETS } from '../src/core.mjs';

const HELP = `ai-obfuscate — JavaScript obfuscator with optional LLM-analysis decoys

Usage:
  ai-obfuscate input.js [-o output.js] [options]
  ai-obfuscate input-directory [-o output-directory] [options]
  ai-obfuscate - -o - [options]             # stdin to stdout

Options:
  -o, --output PATH          Output path; never replaces input files
  --preset light|balanced|strong  Default: balanced
  --seed INTEGER             Deterministic seed (default: 1337)
  --mode refusal|topic       Adversarial comment style (default: refusal)
  --terms WORD,WORD          Decoy subject labels; valid JS names generated
  --target browser|node      Runtime target (default: browser)
  --no-adversarial           Standard JS obfuscation only
  --report PATH              Write JSON report (no LLM evaluation)
  --force                    Overwrite existing output files
  -h, --help                 Display this help
`;

function parseCli(argv) {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
            output: { type: 'string', short: 'o' },
            preset: { type: 'string' },
            seed: { type: 'string' },
            mode: { type: 'string' },
            terms: { type: 'string' },
            target: { type: 'string' },
            'no-adversarial': { type: 'boolean' },
            report: { type: 'string' },
            force: { type: 'boolean' },
            help: { type: 'boolean', short: 'h' }
        }
    });
    if (values.help) return { help: true };
    if (positionals.length !== 1) throw new Error('Specify exactly one input path (or - for stdin).');
    if (values.preset && !PRESETS.includes(values.preset)) throw new Error(`Unknown preset: ${values.preset}`);
    if (values.target && !['browser', 'node'].includes(values.target)) throw new Error('Unknown target');

    const options = {
        preset: values.preset,
        seed: values.seed === undefined ? undefined : Number(values.seed),
        adversarial: !values['no-adversarial'],
        mode: values.mode,
        target: values.target,
        terms: values.terms === undefined ? undefined : values.terms.split(',').map(x => x.trim())
    };
    return {
        input: positionals[0],
        output: values.output,
        report: values.report,
        force: !!values.force,
        options
    };
}

async function readStdin() {
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) text += chunk;
    return text;
}

async function existingStats(path) {
    try {
        return await lstat(path);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

// Resolve existing ancestors even when the destination has not been created.
async function canonicalPath(path) {
    let ancestor = resolve(path);
    const suffix = [];
    for (;;) {
        try {
            return join(await realpath(ancestor), ...suffix);
        } catch (error) {
            if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
            suffix.unshift(basename(ancestor));
            ancestor = dirname(ancestor);
        }
    }
}

async function writeSafe(path, content, force) {
    const existing = await existingStats(path);
    if (existing?.isSymbolicLink()) throw new Error('Symbolic link output/report files are not supported.');
    if (existing && !existing.isFile()) throw new Error('Output/report destinations must be regular files.');
    const destination = join(await canonicalPath(dirname(path)), basename(path));
    await mkdir(dirname(destination), { recursive: true });
    if (!force) {
        await writeFile(destination, content, { flag: 'wx' });
        return;
    }
    // Replace the directory entry atomically instead of following a hardlink
    // or a symlink that appeared after validation and truncating its target.
    const temporary = join(dirname(destination), `.ai-obfuscate-${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, content, { flag: 'wx', mode: existing ? existing.mode & 0o777 : 0o666 });
        await rename(temporary, destination);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function* walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', '.vite'].includes(item.name)) continue;
        const full = join(dir, item.name);
        if (item.isDirectory()) yield* walk(full);
        else if (item.isFile() && /\.(js|mjs|cjs)$/i.test(item.name)) yield full;
        // Symlinks are never followed.
    }
}

function outputPathFor(input, output, directory) {
    if (output) return resolve(output);
    return directory ? `${resolve(input)}-obfuscated` : resolve(input).replace(/(\.[^.]+)?$/, '.obfuscated$1');
}

function isInside(parent, child) {
    const rel = relative(parent, child);
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

async function run() {
    const parsed = parseCli(process.argv.slice(2));
    if (parsed.help) {
        process.stdout.write(HELP);
        return;
    }
    const { input, options, report, force } = parsed;

    if (input === '-') {
        if (parsed.output && parsed.output !== '-') throw new Error('For stdin, use -o - or omit -o');
        const { code, report: item } = obfuscateWithReport(await readStdin(), options, { fileName: 'stdin.js' });
        process.stdout.write(code);
        if (report) await writeSafe(resolve(report), JSON.stringify([item], null, 2), force);
        return;
    }

    const stats = await lstat(resolve(input));
    if (stats.isSymbolicLink()) throw new Error('Symbolic link inputs are not supported.');
    if (!stats.isFile() && !stats.isDirectory()) throw new Error('Input must be a file or directory.');
    const inputPath = await realpath(resolve(input));

    const directory = stats.isDirectory();
    const outputPath = outputPathFor(input, parsed.output, directory);
    const canonicalOutput = await canonicalPath(outputPath);
    if (isInside(inputPath, canonicalOutput) || (directory && isInside(canonicalOutput, inputPath))) {
        throw new Error('Input and output directories may not overlap.');
    }
    if (!directory && !/\.(js|mjs|cjs)$/i.test(extname(inputPath))) {
        throw new Error('Input file must have .js, .mjs or .cjs extension.');
    }
    if (report) {
        const reportPath = await canonicalPath(resolve(report));
        if (reportPath === inputPath || isInside(canonicalOutput, reportPath) || isInside(reportPath, canonicalOutput) ||
            (directory && isInside(inputPath, reportPath))) {
            throw new Error('Report path must not overlap the input or output.');
        }
    }

    const inputs = directory ? [...(await Array.fromAsync(walk(inputPath)))] : [inputPath];
    const identity = item => `${item.dev}:${item.ino}`;
    const inputIdentities = new Set((await Promise.all(inputs.map(file => lstat(file)))).map(identity));
    async function prepareWrite(path) {
        const existing = await existingStats(path);
        if (existing?.isSymbolicLink()) throw new Error('Symbolic link output/report files are not supported.');
        const destination = await canonicalPath(path);
        if (isInside(inputPath, destination) || (existing && inputIdentities.has(identity(existing)))) {
            throw new Error('Output/report path must not replace input files.');
        }
        if (existing && !existing.isFile()) throw new Error('Output/report destinations must be regular files.');
        if (existing && !force) throw new Error(`EEXIST: output/report already exists: ${path}`);
        return { path: destination, identity: existing ? identity(existing) : null };
    }
    // Validate every destination before creating output or report files.
    const writes = [];
    const destinations = new Set();
    for (const file of inputs) {
        const dest = directory ? join(outputPath, relative(inputPath, file)) : outputPath;
        const prepared = await prepareWrite(dest);
        if (destinations.has(prepared.path)) throw new Error('Output paths must not overlap each other.');
        destinations.add(prepared.path);
        writes.push({ file, ...prepared });
    }
    const reportWrite = report ? await prepareWrite(resolve(report)) : null;
    if (reportWrite && writes.some(item => item.path === reportWrite.path ||
        (item.identity && item.identity === reportWrite.identity))) {
        throw new Error('Report path must not overlap the input or output.');
    }
    const reports = [];
    for (const { file, path } of writes) {
        const original = await readFile(file, 'utf8');
        const result = obfuscateWithReport(original, options, { fileName: relative(inputPath, file) || file });
        await writeSafe(path, result.code, force);
        reports.push(result.report);
        process.stderr.write(`Obfuscated ${relative(inputPath, file) || file}: ${result.report.beforeBytes} -> ${result.report.afterBytes} bytes\n`);
    }
    if (reportWrite) await writeSafe(reportWrite.path, JSON.stringify(reports, null, 2), force);
    process.stderr.write(`Completed ${reports.length} file(s). LLM resistance has not been measured.\n`);
}

run().catch(error => {
    process.stderr.write(`ai-obfuscate: ${error.message}\n`);
    process.exitCode = 1;
});
