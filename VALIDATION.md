# Validation

Updated: **2026-11-10**, on Linux. The original `0.1.0` archive is the baseline. The current source adds chunk policies, final output metrics/budgets, CLI configuration/maps/plans, and a bounded build cache while preserving Rolldown's native source-map pipeline.

## Environment and results

Dependencies were installed with npm 11.19.1 using the committed lockfile:

- `javascript-obfuscator` 5.10.0
- Vite 8.3.6 (Rolldown)
- TypeScript 7.0.2
- esbuild 0.28.2 and Terser 5.51.2 (optional Vite backends installed for tests)
- Playwright 1.65.0 with Chromium headless shell for the separate browser fixture

The feature suite passed **78 Node tests** on Node.js 24.22.1, plus type checks, the Vite fixture build, and **one separate Chromium test**. A packed-package consumer also passed the new CLI config/maps/check and Vite policy/report/budget/cache checks. Node CI runs on Node.js 22.12.0 and 24; Chromium checks run separately on Node.js 24.

The minimum runtime is Node.js 22.12.0. The archive declared Node.js 20.19.0, but its directory CLI uses `Array.fromAsync`; the package metadata now matches the supported runtime. Node.js 24 LTS is recommended for development.

## Reproduce the checks

```bash
npm ci --no-audit --no-fund
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run
npx playwright install chromium --only-shell
npm run test:browser
```

The current local verification uses Node.js 24.22.1. [GitHub Actions](.github/workflows/ci.yml) runs the Node checks for Node.js 22.12.0 and 24 and the browser check on Node.js 24 on pushes to `main` and pull requests. A fresh Linux browser runner uses `npx playwright install --with-deps chromium --only-shell`.

The automated suite checks actual Node.js CJS execution, Node ESM imports, and Vite production builds with working dynamic `import()`. It compares results from protected and unprotected builds and verifies all presets, deterministic output, option sanitization, final decoy persistence, content hash changes, chunk exclusions, CLI file/directory/stream handling, overwrite checks, and overlapping paths.

The new integration checks cover:

- Vite's default minification, `true`, `'oxc'`, `false`, `'esbuild'`, and `'terser'`, including balanced and strong presets and dynamic imports with hashed filenames.
- `sourcemap: true`, `'inline'`, `'hidden'`, and `false`, including enabled and disabled adversarial markers.
- Actual thrown error positions mapped through minification, obfuscation, and multiline banners to the original imported module and line, with its original source content.
- Maps without minification and `sourcemapExcludeSources: true`, preserving positions while omitting embedded source when requested.
- Native output settings for custom map filenames and URLs, source path transformation, ignore lists, and debug IDs, with emitted-file metadata and runtime checks.
- Continued minification of excluded chunks and isolated maps/reports across repeated builds, multiple outputs, and watch rebuilds.
- Preserved strict-script directives and executable hashbangs across all presets.
- CLI symlink/hardlink aliases, canonical directory paths, and report/output collisions rejected before writes; legitimate forced writes and stdin reports still work without changing aliased source files.
- Per-chunk callback metadata, global filter precedence, option overrides, skip decisions, rebuild reevaluation, and agreement between transformation and final markers.
- Final emitted bytes, gzip/Brotli sizes, hashes, inline/external map sizes, aggregate budget boundaries, warning behavior, and budget enforcement with report emission disabled.
- CLI map emission and original error positions, directory/stream map modes, map destination protection, and preservation of inputs.
- Explicit JSON configuration and override precedence, config-relative paths, input-relative glob filters, and write-free planning/checking without input execution.
- Cache reuse with unchanged code/maps/hashes, policy/source/map-mode invalidation, disabled caching, entry/serialized-byte limits, mutation isolation for retained maps, and unchanged-chunk reuse during actual watch rebuilds.

The fixture uses `minify: true` and `sourcemap: 'hidden'`.

## Browser verification

`npm run test:browser` builds original and protected variants of `fixtures/browser` and serves them only on loopback. Chromium performs a DOM click, loads a code-split module with Vite's default preload behavior, and exchanges a message with a real Worker. Their results match. The test checks that all protected scripts, including the worker bundle, retain markers.

The fixture is served with a CSP that permits same-origin scripts and workers without `unsafe-eval` or `unsafe-inline`. The verified run had no page errors, failed requests, error-console messages, or CSP violations. It closes browser contexts, the browser, and the HTTP server and removes temporary builds afterward. This checks the fixture's Chromium behavior, not every browser, framework, or application CSP.

## Package verification

`npm pack --dry-run` checks that the package contains both READMEs, MIT license, metadata, executable CLI, implementation modules, and type declarations. Generated bundles, source ZIPs, dependencies, local configuration, and browser fixtures are excluded.

A fresh tarball was also generated with `npm pack` and installed into a separate temporary consumer with Vite 8.3.6 on Node.js 24.22.1. The checks imported both package entry points, executed a transformed ESM module with a core source map, built and ran a Vite library with minification and an emitted map, and invoked the installed CLI help command. All passed. This was a local package test; the package has not been published to npm.

## Publication review

The publication review on 2026-11-10 covered all Git history, tracked source and documentation, package contents, and retained GitHub Actions logs. Gitleaks 8.30.1 and targeted checks found no credentials, private keys, or machine-specific user paths in the reviewed Git contents. Release assets and uploaded workflow artifacts were absent.

The review found and fixed strict-mode/hashbang preservation and CLI alias/report overwrite defects. Compatible dependency remediation removed the vulnerable transitive chain; `npm audit` reports zero known vulnerabilities for the locked tree. The MIT license and contribution/security guidance are included; generated archives, local audit artifacts, and workspace bookkeeping remain outside Git.

## Limits

These checks verify selected program behavior and build configurations. LLM evaluation and provider calls were deliberately omitted; no refusal rates, model-analysis accuracy, or reverse-engineering cost were measured. Build-time and compressed-size metrics do not establish runtime performance or security effectiveness. Most Vite tests use Node's ESM loader, supplemented by the Chromium fixture above; SSR, other browsers, Service Workers, and application-specific CSP requirements still need separate validation. Source maps can expose original code; `'hidden'` suppresses the link without making the map private.
