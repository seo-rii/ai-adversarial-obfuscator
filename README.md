# AI Adversarial Obfuscator

[English](README.md) · [한국어](README.ko.md)

JavaScript obfuscation with optional, non-functional markers intended for experiments with LLM-based code analysis. Includes an ESM API, a command-line tool, TypeScript declarations, and a Vite 8 plugin.

The implementation combines [`javascript-obfuscator`](https://github.com/javascript-obfuscator/javascript-obfuscator) with comments, decoy identifiers, and unreachable code. **Resistance to LLM analysis has not been measured.** The reports describe transformations and file sizes; they do not establish that analysis can be prevented.

## Features

- Three presets: `light`, `balanced`, and `strong`.
- Repeatable transformations with a fixed seed, input, file context, and dependency versions.
- Optional `refusal` comments or neutral `topic` markers, with custom subject labels.
- CLI support for files, directory trees, stdin/stdout, source maps, JSON configuration, file filters, and read-only plans/checks.
- Vite production builds with minification, source maps, code splitting, and dynamic imports.
- Per-chunk Vite policies and bounded transformation caching for repeated builds.
- Final raw/gzip/Brotli size reports, SHA-256 digests, and CI output budgets.
- An option to disable adversarial markers and use ordinary obfuscation.

The marker blocks use `if (false)` and do not execute the operations named by their labels. Obfuscation aims to preserve application behavior, but compatibility must be checked with the application that consumes the output.

## Get started

Requires **Node.js 22.12 or later**; **Node.js 24 LTS** is recommended for development. The Vite integration targets **Vite 8**; the core API and CLI do not require a Vite application.

Clone the repository:

```bash
git clone https://github.com/seo-rii/ai-adversarial-obfuscator.git
cd ai-adversarial-obfuscator
npm ci
npm test
npm run test:types
```

The code is MIT licensed. The package is marked `private` to prevent accidental npm publication; this setting is separate from GitHub repository visibility. No installation from the public npm registry is assumed here.

To use the checkout in another project, install it from its local path:

```bash
# Run in the consuming project, after npm ci in the checkout above.
npm install -D /absolute/path/to/ai-adversarial-obfuscator
```

## Command-line usage

From this repository:

```bash
# Single file; existing output files cause an error by default.
node bin/ai-obfuscate.mjs input.js -o input.protected.js --preset balanced

# Recursively transform .js, .mjs, and .cjs files.
node bin/ai-obfuscate.mjs ./src -o ./protected --preset strong --seed 12345

# Custom labels, neutral marker text, and a JSON report.
node bin/ai-obfuscate.mjs app.js -o app.obf.js \
  --mode topic --terms "ExampleTopic,ReviewMarker" --report report.json

# Ordinary obfuscation without adversarial markers.
node bin/ai-obfuscate.mjs input.js -o input.obf.js --no-adversarial

# Node.js/CommonJS target.
node bin/ai-obfuscate.mjs service.cjs -o service.obf.cjs --target node

# stdin/stdout.
node bin/ai-obfuscate.mjs - -o - --preset light < input.js > output.js

node bin/ai-obfuscate.mjs --help
```

After installing the local package in another project, invoke the installed CLI with `npx --no-install ai-obfuscate`.

Without `-o`, a file is written as `input.obfuscated.js`, and a directory is written to a sibling named `<input>-obfuscated`. Directory processing copies only JavaScript files; copy any required non-JavaScript assets separately. The CLI skips `node_modules`, `.git`, and `.vite`, and does not follow input symlinks. Input and output paths must not overlap. Use `--force` to allow replacement of existing output files.

Output/report file symlinks and aliases to input files are rejected, including with `--force`. Report files must be outside the output directory tree. All destinations are checked before any output is written.

CLI reports contain an array of per-file transformation reports. Progress and errors go to stderr so stdout can carry the transformed source.

### Source maps

```bash
# Adjacent .map file with a sourceMappingURL comment.
node bin/ai-obfuscate.mjs app.js -o app.obf.js --sourcemap true

# A separate map without a link in the JavaScript.
node bin/ai-obfuscate.mjs app.js -o app.obf.js \
  --sourcemap hidden --sourcemap-file ./maps/app.js.map

# A stream can embed its map, or use an explicit external map path.
node bin/ai-obfuscate.mjs - -o - --sourcemap inline < app.js > app.obf.js
```

`--sourcemap` accepts `false` (default), `true`, `inline`, and `hidden`. Directory inputs place external maps next to each output file; `--sourcemap-file` is reserved for a single file or stdin. External stdin maps require that explicit path. Map destinations receive the same collision and input-protection checks as JavaScript and reports. CLI report sizes and hashes describe the core transformation before map links or inline map data are appended.

### Configuration, filtering, and planning

Pass an explicit JSON file with `--config`; executable JavaScript configuration is not loaded. For example, `obfuscator.config.json`:

```json
{
  "input": "./src",
  "output": "./protected",
  "preset": "light",
  "mode": "topic",
  "terms": ["ProjectMarker"],
  "include": ["**/*.js", "**/*.mjs"],
  "exclude": ["**/*.test.*"],
  "sourcemap": "hidden",
  "report": "./reports/obfuscation.json"
}
```

```bash
node bin/ai-obfuscate.mjs --config ./obfuscator.config.json --preset balanced
node bin/ai-obfuscate.mjs ./src -o ./protected --exclude '**/*.test.*' --dry-run
node bin/ai-obfuscate.mjs --config ./obfuscator.config.json --check
```

Precedence is defaults, then configuration, then explicit CLI values. Paths in the JSON file resolve relative to that file; command-line paths resolve relative to the current working directory. The flat configuration accepts `preset`, `seed`, `mode`, `terms`, `target`, `adversarial`, `input`, `output`, `report`, `sourcemap`, `sourcemapFile`, `include`, and `exclude`. Use `sourcemap` here rather than the core API's `sourceMap`. Replacement permission remains CLI-only through `--force`.

File filters use glob patterns over POSIX-style paths relative to the input root. Exclusions take precedence. `--dry-run` prints a JSON write plan without transforming or writing files; `--check` also transforms inputs to catch syntax/option errors, but does not execute the input or write any files. Both retain path safety checks, are mutually exclusive, and apply to file/directory inputs rather than stdin.

## Programmatic API

The package is ESM. Import the core API in a Node.js build script:

```js
import { writeFile } from 'node:fs/promises';
import { obfuscateWithReport } from 'ai-adversarial-obfuscator';

const source = 'export function add(a, b) { return a + b; }';
const { code, report } = obfuscateWithReport(
    source,
    { preset: 'light', seed: 2026, mode: 'topic' },
    { fileName: 'math.js' }
);

await writeFile('math.protected.mjs', code);
console.log(report.beforeBytes, report.afterBytes);
```

The root export also provides `obfuscateSource(source, options, context)` for a string result, `normalizeOptions(options)`, `createAdversarialBlock(options, context)`, `DEFAULT_TERMS`, and `PRESETS`. Type declarations are included in `src/*.d.mts`.

For a source map, pass `sourceMap: true` to `obfuscateWithReport`. Its result includes `map`, which maps the returned code back to the input. Decoy blocks are appended, preserving directive prologues, hashbangs, and the mapped code's positions. Otherwise `map` is `null`. The core API returns the map without writing a file or adding a `sourceMappingURL` comment; the caller handles storage and linking. The CLI and Vite integrations handle those steps for their respective options.

## Vite plugin

Install the local package in a Vite 8 project, then add it to `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { aiAdversarialObfuscator } from 'ai-adversarial-obfuscator/vite';

export default defineConfig({
    plugins: [
        // Place framework transformation plugins before this plugin.
        aiAdversarialObfuscator({
            preset: 'balanced',
            mode: 'topic',
            seed: 2026,
            exclude: /vendor/,
            chunkOptions(chunk) {
                if (chunk.moduleIds.some(id => id.endsWith('/sensitive.js'))) {
                    return { preset: 'strong' };
                }
                return chunk.isEntry ? { preset: 'light' } : undefined;
            },
            budgets: { maxGzipBytes: 500_000, maxGrowthRatio: 12 },
            reportFile: 'ai-obfuscation-report.json'
        })
    ],
    build: {
        minify: true, // Or omit to use Vite's default.
        sourcemap: 'hidden'
    }
});
```

Run the consuming application's normal build command, such as `npm run build`.

Worker production builds need their own plugin factory, for example `worker: { plugins: () => [aiAdversarialObfuscator({ preset: 'balanced' })] }`. See [the browser fixture](fixtures/browser/vite.config.mjs) for a complete main/Worker configuration.

The plugin runs during production builds and processes `.js` and `.mjs` chunks. It applies minification before obfuscation in an ordered `renderChunk` hook, then inserts final markers with Rolldown's `postBanner` and `postFooter` hooks. The transformed output and final markers participate in content hashing, preserving chunk references and dynamic imports. Excluded chunks still receive the configured minification.

`build.minify` supports Vite's default, `true`, `'oxc'`, `false`, `'esbuild'`, and `'terser'`. Native Oxc minification runs in a separate ordered chunk hook immediately before obfuscation; Vite's esbuild and Terser hooks also run before the obfuscation hook. If selecting either optional backend, install it in the consuming project with `npm install -D esbuild` or `npm install -D terser`. With `minify: false`, the obfuscator still compacts its own output.

Source maps follow Vite's configuration automatically; no plugin-specific source-map option or manual plugin reordering is needed. Minification and obfuscation run as separate ordered `renderChunk` hooks, each returning its own transformation map. Rolldown's built-in source-map pipeline composes the complete chain back to the original modules and emits the requested format:

| `build.sourcemap` | Output |
| --- | --- |
| `false` | No source map. |
| `true` | Separate `.map` file and a `sourceMappingURL` comment. |
| `'inline'` | Source map embedded in the JavaScript as a data URL. |
| `'hidden'` | Separate `.map` file without a `sourceMappingURL` comment. |

Rolldown output options for map filenames, base URLs, source-path transforms, ignore lists, debug IDs, and excluding source content remain handled by Rolldown.

Source maps can expose original source code. `'hidden'` omits the link; it does not make a deployed `.map` file private. Keep maps private when uploading them to an error-monitoring service. Subsequent tools can still remove markers or alter output, so any later transformation must preserve the map chain.

## Options

The core API and Vite plugin share these options. The CLI exposes their corresponding flags; use `--no-adversarial` to disable markers.

| Option | Default | Description |
| --- | --- | --- |
| `preset` | `balanced` | `light`, `balanced`, or `strong`. |
| `seed` | `1337` | A positive safe integer. |
| `adversarial` | `true` | Include decoy identifiers, comments, and unreachable markers. |
| `mode` | `refusal` | `refusal` requests that analysis stop; `topic` uses neutral marker text. Neither mode has measured effectiveness. |
| `terms` | Four built-in labels | An array of 1–16 nonempty strings, each at most 80 characters. Control characters and comment terminators are sanitized. |
| `target` | `browser` | `browser` or `node`; selects the obfuscator's runtime target. |

The core API additionally accepts `sourceMap: true` (default: `false`) to return a map from `obfuscateWithReport`. For Vite, configure `build.sourcemap` instead.

Additional Vite options:

| Option | Default | Description |
| --- | --- | --- |
| `include` / `exclude` | Unset | Match chunk file names using a substring, `RegExp`, predicate, or array of those patterns. Exclusions take precedence. |
| `chunkOptions` | Unset | Synchronous per-chunk callback returning option overrides, `false` to skip, or `undefined` to inherit global options. |
| `budgets` | Unset | Aggregate output limits; see below. |
| `cache` | `true` | Bounded in-memory transformation cache; `false`, `true`, or `{ maxEntries, maxBytes }`. |
| `reportFile` | `ai-obfuscation-report.json` | A relative `.json` asset path, or `false` to disable the report. |

`chunkOptions` receives read-only `name`, preliminary `fileName`, `moduleIds`, `isEntry`, `isDynamicEntry`, and `facadeModuleId` metadata. Global include/exclude filters run first, and the callback runs once per selected chunk in each output generation. Its decision is reused for transformation and final markers. Returning `false` skips both while retaining configured minification. Policies apply to whole chunks; use the bundler's code-splitting configuration when modules need separate treatment.

### Reports and CI budgets

Vite reports use `schemaVersion: 2`:

- `chunks` contains transformed chunks with core measurements, `transformMs`, `cacheHit`, and final `emitted` metrics.
- `files` describes all emitted JavaScript chunks, including skipped chunks: final filename, raw/gzip/Brotli bytes, SHA-256, and source-map bytes.
- `totals` aggregates one output; `budgetViolations` records exceeded limits when warning mode allows the build to continue.
- `cache` reports generation-specific hits, misses, and evictions, plus currently retained entries and payload bytes.

Core measurements remain available: `fileName`, selected options, `sourceSha256`, `outputSha256`, `beforeBytes`, `afterBytes`, `sizeRatio`, and `evaluation: 'not-performed'`. For Vite, these measure the post-minify input and the `renderChunk` transformation. Final metrics separately include rendering, markers, and map links. `mapBytes` counts decoded inline map data or separate map content; inline JavaScript bytes already include its encoded map. Timing is diagnostic and can vary between identical builds.

`budgets` accepts `maxBytes`, `maxGzipBytes`, `maxBrotliBytes`, and `maxGrowthRatio`, with `onExceeded: 'error'` (default) or `'warn'`. Limits apply to the sum of all JavaScript chunks in each output, including excluded chunks. Growth is final JavaScript bytes divided by input bytes after minification. Budgets remain active with `reportFile: false`; separate map bytes are reported separately from JavaScript budgets. These metrics measure output cost, not security effectiveness or runtime speed.

### Repeated-build cache

The default cache retains up to 128 entries and 32 MiB of serialized transformation payload per plugin instance. `maxBytes` bounds that payload, rather than total JavaScript heap usage. Use `cache: { maxEntries: 64, maxBytes: 8 * 1024 * 1024 }` to change the positive integer bounds, or `cache: false` to disable it. The bounded LRU cache reuses code, maps, and core reports when input, effective chunk options, file context, output format, and source-map mode match. It survives watch rebuilds and repeated builds using that plugin instance; it does not persist across processes. Policies still run for each generation, and reported hit timing measures the current lookup, hashing, and cloning work.

## Presets

| Preset | String handling | Control-flow flattening | Dead-code injection | Expected overhead |
| --- | --- | --- | --- | --- |
| `light` | String arrays | Disabled | Disabled | Lower |
| `balanced` | Base64 string arrays | Partial | Disabled | Moderate |
| `strong` | Base64 string arrays and string splitting | More aggressive | Enabled | Higher |

Adversarial marker blocks are controlled separately from these transformation presets. `strong` can increase bundle size and execution cost substantially. Property renaming, global renaming, self-defending output, debugger interference, and console suppression are disabled in the implementation.

## Development and validation

```bash
npm ci
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run

# Separate real-browser checks (Chromium only).
npx playwright install chromium --only-shell
npm run test:browser
```

The Node suite exercises presets, deterministic output, CLI safety/configuration/maps/plans, chunk policies, final reports and budgets, caching, minification, content hashes, and source-map positions. The separate Chromium fixture compares original and protected DOM interactions, default preload behavior, dynamic imports, and a real Worker under a CSP without `unsafe-eval` or `unsafe-inline`. See [VALIDATION.md](VALIDATION.md) for the recorded environment and coverage.

```text
bin/                    Command-line entry point
src/core.mjs            Core transformations and reports
src/vite.mjs            Vite production-build plugin
src/*.d.mts             Public TypeScript declarations
test/                   Runtime and type checks
fixtures/vite/          Small Vite integration application
fixtures/browser/       DOM, dynamic-import, Worker, and CSP fixture
test/browser/           Separate Chromium checks
```

## Scope and limitations

Obfuscation can make code harder to inspect, but client-side code remains available for tracing, modification, and dynamic analysis. Keep credentials and other secrets out of distributed JavaScript.

Comments and unreachable code can be removed through AST normalization or rebundling. Default subject labels can trigger scanner or platform false positives; select custom terms or disable adversarial markers when appropriate. LLM refusal rates, reverse-engineering cost, and protection against particular models have not been evaluated.

Validate CSP requirements, browser behavior, SSR, Web Workers, Service Workers, reflection, and dynamically generated code in your application. Passing the included tests does not establish compatibility with every JavaScript program.

LLM evaluation is not implemented or run. No provider calls or measured refusal/analysis rates are supplied by these functional and size checks.

## Contributing, security, and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, [SECURITY.md](SECURITY.md) for vulnerability reporting, and [CHANGELOG.md](CHANGELOG.md) for release notes.

This is an independent implementation inspired by [ACODA](https://github.com/security-pride/Acoda), unaffiliated with its authors. This repository makes no claim to reproduce another implementation's results.

Licensed under the [MIT License](LICENSE). Dependencies retain their own licenses.
