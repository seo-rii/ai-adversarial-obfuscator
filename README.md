# AI Adversarial Obfuscator

[English](README.md) · [한국어](README.ko.md)

JavaScript obfuscation with optional, non-functional markers intended for experiments with LLM-based code analysis. Includes an ESM API, a command-line tool, TypeScript declarations, and a Vite 8 plugin.

The implementation combines [`javascript-obfuscator`](https://github.com/javascript-obfuscator/javascript-obfuscator) with comments, decoy identifiers, and unreachable code. **Resistance to LLM analysis has not been measured.** The reports describe transformations and file sizes; they do not establish that analysis can be prevented.

## Features

- Three presets: `light`, `balanced`, and `strong`.
- Repeatable transformations with a fixed seed, input, file context, and dependency versions.
- Optional `refusal` comments or neutral `topic` markers, with custom subject labels.
- CLI support for individual files, directory trees, and stdin/stdout.
- Vite production builds with minification, source maps, code splitting, and dynamic imports.
- JSON reports with byte counts and SHA-256 digests.
- An option to disable adversarial markers and use ordinary obfuscation.

The marker blocks use `if (false)` and do not execute the operations named by their labels. Obfuscation aims to preserve application behavior, but compatibility must be checked with the application that consumes the output.

## Get started

Requires **Node.js 22.12 or later**; **Node.js 24 LTS** is recommended for development. The Vite integration targets **Vite 8**; the core API and CLI do not require a Vite application.

Clone the repository with a GitHub account that has access:

```bash
git clone https://github.com/seo-rii/ai-adversarial-obfuscator.git
cd ai-adversarial-obfuscator
npm ci
npm test
npm run test:types
```

The repository is currently private. Its code is MIT licensed, and the package is marked `private` to prevent accidental npm publication. No installation from the public npm registry is assumed here.

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

CLI reports contain an array of per-file transformation reports. Progress and errors go to stderr so stdout can carry the transformed source.

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

For a source map, pass `sourceMap: true` to `obfuscateWithReport`. Its result includes `map`, which maps the returned code back to the input, including the offset of any prepended decoy block. Otherwise `map` is `null`. The core API returns the map without writing a file or adding a `sourceMappingURL` comment; the caller handles storage and linking. The CLI has no source-map flag.

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

The plugin runs during production builds and processes `.js` and `.mjs` chunks. It applies minification before obfuscation in an ordered `renderChunk` hook, then inserts final markers with Rolldown's `postBanner` and `postFooter` hooks. The transformed output and final markers participate in content hashing, preserving chunk references and dynamic imports. Excluded chunks still receive the configured minification.

`build.minify` supports Vite's default, `true`, `'oxc'`, `false`, `'esbuild'`, and `'terser'`. Native Oxc minification runs inside the plugin's final chunk hook before obfuscation; Vite's esbuild and Terser hooks run before that hook. If selecting either optional backend, install it in the consuming project with `npm install -D esbuild` or `npm install -D terser`. With `minify: false`, the obfuscator still compacts its own output.

Source maps follow Vite's configuration automatically; no plugin-specific source-map option or manual plugin reordering is needed. The plugin composes the minifier and obfuscator maps, and Rolldown connects them to the original modules and emits the requested format:

| `build.sourcemap` | Output |
| --- | --- |
| `false` | No source map. |
| `true` | Separate `.map` file and a `sourceMappingURL` comment. |
| `'inline'` | Source map embedded in the JavaScript as a data URL. |
| `'hidden'` | Separate `.map` file without a `sourceMappingURL` comment. |

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
| `reportFile` | `ai-obfuscation-report.json` | A relative `.json` asset path, or `false` to disable the report. |

Each core report includes `fileName`, selected options, `sourceSha256`, `outputSha256`, `beforeBytes`, `afterBytes`, `sizeRatio`, and `evaluation: 'not-performed'`. Vite emits these reports under `chunks`, together with each chunk's name. Its input measurements describe the code after any configured minification, and output measurements describe the obfuscation result in `renderChunk`. They can differ from final on-disk bytes and digests after output hooks, rendering, and source-map linking. Each output or rebuild receives its own report entries.

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
```

The tests exercise all presets, deterministic output, option validation, CLI file/directory/stream handling, CJS execution, Vite minification backends, chunk imports, dynamic imports, marker persistence, content hashes, exclusions, and source-map emission. Source-map checks resolve thrown errors back to original source lines through the transform chain. Vite execution tests use Node's ESM loader; they are not browser end-to-end tests. See [VALIDATION.md](VALIDATION.md) for the recorded environment and results.

```text
bin/                    Command-line entry point
src/core.mjs            Core transformations and reports
src/vite.mjs            Vite production-build plugin
src/*.d.mts             Public TypeScript declarations
test/                   Runtime and type checks
fixtures/vite/          Small Vite integration application
```

## Scope and limitations

Obfuscation can make code harder to inspect, but client-side code remains available for tracing, modification, and dynamic analysis. Keep credentials and other secrets out of distributed JavaScript.

Comments and unreachable code can be removed through AST normalization or rebundling. Default subject labels can trigger scanner or platform false positives; select custom terms or disable adversarial markers when appropriate. LLM refusal rates, reverse-engineering cost, and protection against particular models have not been evaluated.

Validate CSP requirements, browser behavior, SSR, Web Workers, Service Workers, reflection, and dynamically generated code in your application. Passing the included tests does not establish compatibility with every JavaScript program.

## Contributing, security, and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, [SECURITY.md](SECURITY.md) for vulnerability reporting, and [CHANGELOG.md](CHANGELOG.md) for release notes.

This is an independent implementation inspired by [ACODA](https://github.com/security-pride/Acoda), unaffiliated with its authors. This repository makes no claim to reproduce another implementation's results.

Licensed under the [MIT License](LICENSE). Dependencies retain their own licenses.
