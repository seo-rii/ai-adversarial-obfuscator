#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
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

async function writeSafe(path, content, force) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: force ? 'w' : 'wx' });
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

    const inputPath = resolve(input);
    const stats = await lstat(inputPath);
    if (stats.isSymbolicLink()) throw new Error('Symbolic link inputs are not supported.');
    if (!stats.isFile() && !stats.isDirectory()) throw new Error('Input must be a file or directory.');

    const directory = stats.isDirectory();
    const outputPath = outputPathFor(input, parsed.output, directory);
    if (isInside(inputPath, outputPath) || (directory && isInside(outputPath, inputPath))) {
        throw new Error('Input and output directories may not overlap.');
    }
    if (!directory && !/\.(js|mjs|cjs)$/i.test(extname(inputPath))) {
        throw new Error('Input file must have .js, .mjs or .cjs extension.');
    }
    if (report) {
        const reportPath = resolve(report);
        if (reportPath === inputPath || reportPath === outputPath ||
            (directory && isInside(inputPath, reportPath))) {
            throw new Error('Report path must not overlap the input or output.');
        }
    }

    const inputs = directory ? [...(await Array.fromAsync(walk(inputPath)))] : [inputPath];
    const reports = [];
    for (const file of inputs) {
        const dest = directory ? join(outputPath, relative(inputPath, file)) : outputPath;
        const original = await readFile(file, 'utf8');
        const result = obfuscateWithReport(original, options, { fileName: relative(inputPath, file) || file });
        await writeSafe(dest, result.code, force);
        reports.push(result.report);
        process.stderr.write(`Obfuscated ${relative(inputPath, file) || file}: ${result.report.beforeBytes} -> ${result.report.afterBytes} bytes\n`);
    }
    if (report) await writeSafe(resolve(report), JSON.stringify(reports, null, 2), force);
    process.stderr.write(`Completed ${reports.length} file(s). LLM resistance has not been measured.\n`);
}

run().catch(error => {
    process.stderr.write(`ai-obfuscate: ${error.message}\n`);
    process.exitCode = 1;
});
