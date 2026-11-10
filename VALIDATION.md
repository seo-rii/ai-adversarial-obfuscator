# Validation

Last verified: **2026-11-10**, on Linux. The original `0.1.0` archive is the baseline. The current source adds minify-first Vite processing and composed source maps, with runtime, mapping, and rebuild regressions.

## Environment and results

Dependencies were installed with npm 11.19.1 using the committed lockfile:

- `javascript-obfuscator` 5.10.0
- Vite 8.3.6 (Rolldown)
- TypeScript 7.0.2
- `@jridgewell/remapping` 2.3.5
- esbuild 0.28.2 and Terser 5.51.2 (optional Vite backends installed for tests)

| Runtime | Runtime tests | Type declarations | Vite fixture build |
| --- | --- | --- | --- |
| Node.js 24.22.1 | 28 passed, 0 failed | Passed | Passed |

The archive baseline previously passed 11 tests on Node.js 22.12.0 and 24.22.1. The expanded suite is also run on Node.js 22.12.0 and 24 by GitHub Actions.

The minimum runtime is Node.js 22.12.0. The archive declared Node.js 20.19.0, but its directory CLI uses `Array.fromAsync`; the package metadata now matches the supported runtime. Node.js 24 LTS is recommended for development.

## Reproduce the checks

```bash
npm ci --no-audit --no-fund
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run
```

The current local verification uses Node.js 24.22.1. [GitHub Actions](.github/workflows/ci.yml) runs the same checks for Node.js 22.12.0 and 24 on pushes to `main` and pull requests.

The automated suite checks actual Node.js CJS execution, Node ESM imports, and Vite production builds with working dynamic `import()`. It compares results from protected and unprotected builds and verifies all presets, deterministic output, option sanitization, final decoy persistence, content hash changes, chunk exclusions, CLI file/directory/stream handling, overwrite checks, and overlapping paths.

The new integration checks cover:

- Vite's default minification, `true`, `'oxc'`, `false`, `'esbuild'`, and `'terser'`, including balanced and strong presets and dynamic imports with hashed filenames.
- `sourcemap: true`, `'inline'`, `'hidden'`, and `false`, including enabled and disabled adversarial markers.
- Actual thrown error positions mapped through minification, obfuscation, and multiline banners to the original imported module and line, with its original source content.
- Maps without minification and `sourcemapExcludeSources: true`, preserving positions while omitting embedded source when requested.
- Continued minification of excluded chunks and isolated maps/reports across repeated builds, multiple outputs, and watch rebuilds.

The fixture uses `minify: true` and `sourcemap: 'hidden'`.

## Package verification

`npm pack --dry-run` verified a nine-file package containing both READMEs, MIT license, metadata, executable CLI, implementation modules, and type declarations. Generated bundles, source ZIPs, dependencies, and local configuration are excluded.

A fresh tarball was also generated with `npm pack` and installed into a separate temporary consumer with Vite 8.3.6 on Node.js 24.22.1. The checks imported both package entry points, executed a transformed ESM module with a core source map, built and ran a Vite library with minification and an emitted map, and invoked the installed CLI help command. All passed. This was a local package test; the package has not been published to npm.

## Limits

These checks verify selected program behavior and build configurations. They do not measure LLM resistance or reverse-engineering cost, and they do not establish a security guarantee. Vite runtime tests use Node's ESM loader; actual browser E2E, CSP, SSR, Web Worker, and Service Worker compatibility remain application-specific. Source maps can expose original code; `'hidden'` suppresses the link without making the map private.
