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
  --sourcemap false|true|inline|hidden  Default: false
  --sourcemap-file PATH      Separate map path for one file or stdin
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
            sourcemap: { type: 'string' },
            'sourcemap-file': { type: 'string' },
            report: { type: 'string' },
            force: { type: 'boolean' },
            help: { type: 'boolean', short: 'h' }
        }
    });
    if (values.help) return { help: true };
    if (positionals.length !== 1) throw new Error('Specify exactly one input path (or - for stdin).');
    if (values.preset && !PRESETS.includes(values.preset)) throw new Error(`Unknown preset: ${values.preset}`);
    if (values.target && !['browser', 'node'].includes(values.target)) throw new Error('Unknown target');
    const sourcemap = values.sourcemap ?? 'false';
    if (!['false', 'true', 'inline', 'hidden'].includes(sourcemap)) {
        throw new Error('sourcemap must be false, true, inline, or hidden');
    }
    if (values['sourcemap-file'] !== undefined &&
        (!values['sourcemap-file'] || !['true', 'hidden'].includes(sourcemap))) {
        throw new Error('sourcemap-file requires sourcemap=true or sourcemap=hidden');
    }

    const options = {
        preset: values.preset,
        seed: values.seed === undefined ? undefined : Number(values.seed),
        adversarial: !values['no-adversarial'],
        sourceMap: sourcemap !== 'false',
        mode: values.mode,
        target: values.target,
        terms: values.terms === undefined ? undefined : values.terms.split(',').map(x => x.trim())
    };
    return {
        input: positionals[0],
        output: values.output,
        report: values.report,
        force: !!values.force,
        sourcemap,
        sourcemapFile: values['sourcemap-file'],
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
            const canonical = await realpath(ancestor);
            if (suffix.length && !(await lstat(canonical)).isDirectory()) {
                throw new Error('Output/report/map parent paths must be directories.');
            }
            return join(canonical, ...suffix);
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

const identity = item => `${item.dev}:${item.ino}`;

async function prepareDestination(path, force) {
    const existing = await existingStats(path);
    if (existing?.isSymbolicLink()) throw new Error('Symbolic link output/report/map files are not supported.');
    if (existing && !existing.isFile()) throw new Error('Output/report/map destinations must be regular files.');
    if (existing && !force) throw new Error(`EEXIST: output/report/map already exists: ${path}`);
    return { path: await canonicalPath(path), identity: existing ? identity(existing) : null };
}

function validateDestinations(writes) {
    const paths = new Set(writes.map(item => item.path));
    if (paths.size !== writes.length) {
        throw new Error('Output, source-map, and report paths must not overlap or alias each other.');
    }
    const identities = new Set();
    for (const item of writes) {
        if (item.identity && identities.has(item.identity)) {
            throw new Error('Output, source-map, and report paths must not overlap or alias each other.');
        }
        if (item.identity) identities.add(item.identity);
        for (let parent = dirname(item.path); ; parent = dirname(parent)) {
            if (paths.has(parent)) {
                throw new Error('Output, source-map, and report paths must not overlap or alias each other.');
            }
            if (dirname(parent) === parent) break;
        }
    }
}

function sourceMapOutput(result, mode, input, output, mapPath) {
    if (!result.map) return { code: result.code, map: null };
    const map = { ...result.map };
    if (output) map.file = basename(output);
    if (input) {
        const base = mode === 'inline' ? dirname(output) : dirname(mapPath);
        map.sources = [relative(base, input).split(sep).join('/')];
    }
    const contents = JSON.stringify(map);
    let code = result.code;
    if (mode === 'inline') {
        code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(contents).toString('base64')}\n`;
    } else if (mode === 'true') {
        const link = relative(output ? dirname(output) : process.cwd(), mapPath)
            .split(sep).map(encodeURIComponent).join('/');
        code += `\n//# sourceMappingURL=${link}\n`;
    }
    return { code, map: contents };
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
    const { input, options, report, force, sourcemap, sourcemapFile } = parsed;

    if (input === '-') {
        if (parsed.output && parsed.output !== '-') throw new Error('For stdin, use -o - or omit -o');
        if (['true', 'hidden'].includes(sourcemap) && !sourcemapFile) {
            throw new Error('For stdin with an external source map, specify --sourcemap-file');
        }
        const mapWrite = sourcemapFile ? await prepareDestination(resolve(sourcemapFile), force) : null;
        const reportWrite = report ? await prepareDestination(resolve(report), force) : null;
        validateDestinations([mapWrite, reportWrite].filter(Boolean));
        const result = obfuscateWithReport(await readStdin(), options, { fileName: 'stdin.js' });
        const generated = sourceMapOutput(result, sourcemap, null, null, mapWrite?.path);
        if (mapWrite) await writeSafe(mapWrite.path, generated.map, force);
        if (reportWrite) await writeSafe(reportWrite.path, JSON.stringify([result.report], null, 2), force);
        process.stdout.write(generated.code);
        return;
    }

    const stats = await lstat(resolve(input));
    if (stats.isSymbolicLink()) throw new Error('Symbolic link inputs are not supported.');
    if (!stats.isFile() && !stats.isDirectory()) throw new Error('Input must be a file or directory.');
    const inputPath = await realpath(resolve(input));

    const directory = stats.isDirectory();
    if (directory && sourcemapFile) throw new Error('sourcemap-file is only supported for one file or stdin');
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
    const inputIdentities = new Set((await Promise.all(inputs.map(file => lstat(file)))).map(identity));
    async function prepareWrite(path) {
        const destination = await prepareDestination(path, force);
        if (isInside(inputPath, destination.path) ||
            (destination.identity && inputIdentities.has(destination.identity))) {
            throw new Error('Output/report/map path must not replace input files.');
        }
        return destination;
    }
    // Validate every destination before creating output or report files.
    const writes = [];
    const destinations = [];
    for (const file of inputs) {
        const dest = directory ? join(outputPath, relative(inputPath, file)) : outputPath;
        const prepared = await prepareWrite(dest);
        const mapWrite = ['true', 'hidden'].includes(sourcemap)
            ? await prepareWrite(sourcemapFile ? resolve(sourcemapFile) : `${prepared.path}.map`)
            : null;
        destinations.push(prepared);
        if (mapWrite) destinations.push(mapWrite);
        writes.push({ file, ...prepared, mapWrite });
    }
    const reportWrite = report ? await prepareWrite(resolve(report)) : null;
    if (reportWrite) destinations.push(reportWrite);
    validateDestinations(destinations);
    const reports = [];
    for (const { file, path, mapWrite } of writes) {
        const original = await readFile(file, 'utf8');
        const result = obfuscateWithReport(original, options, { fileName: relative(inputPath, file) || file });
        const generated = sourceMapOutput(result, sourcemap, file, path, mapWrite?.path);
        await writeSafe(path, generated.code, force);
        if (mapWrite) await writeSafe(mapWrite.path, generated.map, force);
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
