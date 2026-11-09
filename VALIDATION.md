# Validation

Last verified: **2026-11-10**, on Linux. Runtime source, declarations, fixtures, and tests were imported unchanged from `ai-adversarial-obfuscator-0.1.0.zip`. Repository documentation, package metadata, and CI configuration were added or updated separately.

## Environment and results

Dependencies were installed with npm 11.19.1 using the committed lockfile:

- `javascript-obfuscator` 5.10.0
- Vite 8.3.6 (Rolldown)
- TypeScript 7.0.2

| Runtime | Runtime tests | Type declarations | Vite fixture build |
| --- | --- | --- | --- |
| Node.js 22.12.0 | 11 passed, 0 failed | Passed | Passed |
| Node.js 24.22.1 | 11 passed, 0 failed | Passed | Passed |

The minimum runtime is Node.js 22.12.0. The archive declared Node.js 20.19.0, but its directory CLI uses `Array.fromAsync`; the package metadata now matches the supported runtime. Node.js 24 LTS is recommended for development.

## Reproduce the checks

```bash
npm ci --no-audit --no-fund
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run
```

The runtime tests, type checks, and fixture build were run with both Node.js versions above. [GitHub Actions](.github/workflows/ci.yml) runs the same checks for Node.js 22.12.0 and 24 on pushes to `main` and pull requests.

The automated suite checks actual Node.js CJS execution, Node ESM imports, and a Vite production build with a working dynamic `import()`. It compares results from protected and unprotected builds. It also verifies all presets, deterministic output, option sanitization, persistence of final decoy comments and inert code, content hash changes, chunk exclusions, CLI file/directory/stream handling, overwrite checks, overlapping paths, and rejected build settings.

## Package verification

`npm pack --dry-run` verified a nine-file package containing both READMEs, MIT license, metadata, executable CLI, implementation modules, and type declarations. Generated bundles, source ZIPs, dependencies, and local configuration are excluded.

A fresh tarball was also generated with `npm pack` and installed into a separate temporary consumer on Node.js 24.22.1. The checks imported both package entry points, executed a transformed ESM function, ran the installed CLI help command, and piped source through the CLI before executing its output. All passed. This was a local package test; the package has not been published to npm.

## Limits

These checks verify selected program behavior and build configurations. They do not measure LLM resistance or reverse-engineering cost, and they do not establish a security guarantee. Vite runtime tests use Node's ESM loader; actual browser E2E, CSP, SSR, Web Worker, and Service Worker compatibility remain application-specific. Source maps are deliberately disabled.
