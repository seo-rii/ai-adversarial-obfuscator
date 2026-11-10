#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, rename, rm } from 'node:fs/promises';
import { minimatch } from 'minimatch';
import { obfuscateWithReport, normalizeOptions, PRESETS } from '../src/core.mjs';

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
  --config PATH              Read explicit JSON configuration
  --include GLOB             Select input-relative files (repeatable)
  --exclude GLOB             Exclude input-relative files (repeatable)
  --dry-run                  Print the validated write plan without transforming
  --check                    Validate transformations without writing files
  --report PATH              Write JSON report (no LLM evaluation)
  --force                    Overwrite existing output files
  -h, --help                 Display this help
`;

async function parseCli(argv) {
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
            config: { type: 'string' },
            include: { type: 'string', multiple: true },
            exclude: { type: 'string', multiple: true },
            'dry-run': { type: 'boolean' },
            check: { type: 'boolean' },
            report: { type: 'string' },
            force: { type: 'boolean' },
            help: { type: 'boolean', short: 'h' }
        }
    });
    if (values.help) return { help: true };
    if (positionals.length > 1) throw new Error('Specify exactly one input path (or - for stdin).');
    if (values['dry-run'] && values.check) throw new Error('dry-run and check are mutually exclusive');
    let config = {};
    let configuration = null;
    if (values.config !== undefined) {
        const path = resolve(values.config);
        try {
            config = JSON.parse(await readFile(path, 'utf8'));
        } catch (error) {
            throw new Error(`Cannot read JSON configuration: ${error.message}`);
        }
        validateConfig(config);
        const canonical = await realpath(path);
        configuration = { path: canonical, identity: identity(await lstat(canonical)) };
        for (const key of ['input', 'output', 'report', 'sourcemapFile']) {
            if (config[key] !== undefined && !(['input', 'output'].includes(key) && config[key] === '-')) {
                config[key] = resolve(dirname(path), config[key]);
            }
        }
    }
    const input = positionals[0] ?? config.input;
    if (input === undefined) throw new Error('Specify exactly one input path (or - for stdin).');
    if (values.preset && !PRESETS.includes(values.preset)) throw new Error(`Unknown preset: ${values.preset}`);
    if (values.target && !['browser', 'node'].includes(values.target)) throw new Error('Unknown target');
    const sourcemap = String(values.sourcemap ?? config.sourcemap ?? 'false');
    if (!['false', 'true', 'inline', 'hidden'].includes(sourcemap)) {
        throw new Error('sourcemap must be false, true, inline, or hidden');
    }
    // An explicit inline/disabled mode also overrides the configured external
    // destination. An explicitly incompatible CLI destination still errors.
    const configuredMapFile = values.sourcemap !== undefined && !['true', 'hidden'].includes(sourcemap)
        ? undefined : config.sourcemapFile;
    const sourcemapFile = values['sourcemap-file'] ?? configuredMapFile;
    if (sourcemapFile !== undefined &&
        (!sourcemapFile || !['true', 'hidden'].includes(sourcemap))) {
        throw new Error('sourcemap-file requires sourcemap=true or sourcemap=hidden');
    }

    const options = normalizeOptions({
        preset: values.preset ?? config.preset,
        seed: values.seed === undefined ? config.seed : Number(values.seed),
        adversarial: values['no-adversarial'] ? false : config.adversarial,
        sourceMap: sourcemap !== 'false',
        mode: values.mode ?? config.mode,
        target: values.target ?? config.target,
        terms: values.terms === undefined ? config.terms : values.terms.split(',').map(x => x.trim())
    });
    const include = values.include ?? config.include;
    const exclude = values.exclude ?? config.exclude;
    validateGlobs(include, 'include');
    validateGlobs(exclude, 'exclude');
    return {
        input,
        output: values.output ?? config.output,
        report: values.report ?? config.report,
        force: !!values.force,
        sourcemap,
        sourcemapFile,
        include: typeof include === 'string' ? [include] : include,
        exclude: typeof exclude === 'string' ? [exclude] : exclude,
        planMode: values['dry-run'] ? 'dry-run' : values.check ? 'check' : null,
        configuration,
        options
    };
}

function validateGlobs(value, name) {
    if (value === undefined) return;
    const patterns = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string' || !pattern || pattern.includes('\0'))) {
        throw new TypeError(`${name} must be a glob string or an array of glob strings`);
    }
}

function validateConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Configuration must be a JSON object');
    const coreKeys = ['preset', 'seed', 'mode', 'terms', 'target', 'adversarial'];
    const pathKeys = ['input', 'output', 'report', 'sourcemapFile'];
    const allowed = new Set([...coreKeys, ...pathKeys, 'sourcemap', 'include', 'exclude']);
    for (const [key, value] of Object.entries(config)) {
        if (!allowed.has(key)) throw new TypeError(`Unknown configuration option: ${key}`);
        if (pathKeys.includes(key) && (typeof value !== 'string' || !value || value.includes('\0'))) {
            throw new TypeError(`Configuration ${key} must be a nonempty path string`);
        }
        if (['preset', 'mode', 'target'].includes(key) && typeof value !== 'string') {
            throw new TypeError(`Configuration ${key} must be a string`);
        }
        if (key === 'seed' && typeof value !== 'number') throw new TypeError('Configuration seed must be a number');
        if (key === 'adversarial' && typeof value !== 'boolean') throw new TypeError('Configuration adversarial must be a boolean');
        if (key === 'sourcemap' && ![false, true, 'false', 'true', 'inline', 'hidden'].includes(value)) {
            throw new TypeError('Configuration sourcemap must be false, true, inline, or hidden');
        }
    }
    validateGlobs(config.include, 'include');
    validateGlobs(config.exclude, 'exclude');
    normalizeOptions(Object.fromEntries(coreKeys.filter(key => Object.hasOwn(config, key)).map(key => [key, config[key]])));
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

function validateDestinations(writes, configuration) {
    const paths = new Set(writes.map(item => item.path));
    if (paths.size !== writes.length) {
        throw new Error('Output, source-map, and report paths must not overlap or alias each other.');
    }
    const identities = new Set();
    for (const item of writes) {
        if (configuration && (item.path === configuration.path || item.identity === configuration.identity)) {
            throw new Error('Output/report/map paths must not replace the configuration file.');
        }
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
    const parsed = await parseCli(process.argv.slice(2));
    if (parsed.help) {
        process.stdout.write(HELP);
        return;
    }
    const { input, options, report, force, sourcemap, sourcemapFile, include, exclude, planMode, configuration } = parsed;

    if (input === '-') {
        if (planMode) throw new Error('dry-run and check require file or directory input; stdin is not supported');
        if (include !== undefined || exclude !== undefined) throw new Error('Input globs require file or directory input');
        if (parsed.output && parsed.output !== '-') throw new Error('For stdin, use -o - or omit -o');
        if (['true', 'hidden'].includes(sourcemap) && !sourcemapFile) {
            throw new Error('For stdin with an external source map, specify --sourcemap-file');
        }
        const mapWrite = sourcemapFile ? await prepareDestination(resolve(sourcemapFile), force) : null;
        const reportWrite = report ? await prepareDestination(resolve(report), force) : null;
        validateDestinations([mapWrite, reportWrite].filter(Boolean), configuration);
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

    const discovered = directory ? [...(await Array.fromAsync(walk(inputPath)))] : [inputPath];
    const inputs = discovered.filter(file => {
        const name = (directory ? relative(inputPath, file) : basename(file)).split(sep).join('/');
        const matches = pattern => minimatch(name, pattern, { dot: true });
        return (include === undefined || include.some(matches)) && !(exclude ?? []).some(matches);
    });
    const inputIdentities = new Set((await Promise.all(discovered.map(file => lstat(file)))).map(identity));
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
    validateDestinations(destinations, configuration);
    if (planMode) {
        if (planMode === 'check') {
            for (const { file } of writes) {
                obfuscateWithReport(await readFile(file, 'utf8'), options, {
                    fileName: relative(inputPath, file) || file
                });
            }
        }
        process.stdout.write(JSON.stringify({
            mode: planMode,
            files: writes.map(({ file, path, mapWrite }) => ({
                input: file, output: path, ...(mapWrite ? { sourcemapFile: mapWrite.path } : {})
            })),
            report: reportWrite?.path ?? null
        }, null, 2) + '\n');
        return;
    }
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
