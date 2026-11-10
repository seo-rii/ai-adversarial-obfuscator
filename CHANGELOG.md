# Changelog

Changes to the project are recorded here. Version entries describe repository development and do not imply publication to npm or the existence of a release tag.

## [Unreleased]

### Added

- Per-chunk Vite option policies with module/entry metadata and shared decisions for transformation and final markers.
- Final raw/gzip/Brotli size, hash, and map metrics; aggregate CI budgets with error or warning behavior.
- CLI external, inline, and hidden source maps, JSON configuration, include/exclude globs, and write-free `--dry-run`/`--check` modes.
- Bounded in-memory LRU transformation caching with per-generation hit/miss/eviction reporting and input, policy, output, and map-mode invalidation.
- A separate Chromium fixture covering DOM interaction, default preload, dynamic imports, real Workers, and strict CSP without `unsafe-eval` or `unsafe-inline`.
- Source-map generation in the core API through `sourceMap: true`, with a separate `map` result and trailing inert markers.
- Vite source-map composition and emission for `true`, `'inline'`, and `'hidden'`, following Vite's configuration automatically.
- Integration coverage for minification backends, original error locations, excluded chunks, repeated builds, and multiple outputs.

### Changed

- Support Vite's default, Oxc, esbuild, and Terser minification before chunk obfuscation, replacing the minify and source-map configuration restrictions.
- Keep minification enabled for excluded chunks and isolate report entries for each output and rebuild.
- Return individual transformation maps from separate ordered hooks so Rolldown handles all map composition and emission without a separate remapping dependency.
- Extend Vite reports with `schemaVersion: 2`, final output metrics, budget violations, and cache statistics while retaining core transformation measurements. LLM evaluation remains unimplemented and unmeasured.

### Fixed

- Preserve strict-mode directives and executable hashbangs by appending core decoy blocks after the transformed source.
- Protect CLI input files from forced writes through filesystem aliases and prevent report paths from overwriting generated JavaScript.
- Resolve the vulnerable transitive dependency chain using compatible lockfile versions before public release.

## [0.1.0] - 2026-11-10

### Added

- Imported the `0.1.0` source archive into a Git repository.
- JavaScript ESM API with `light`, `balanced`, and `strong` obfuscation presets, deterministic seeds, optional inert analysis decoys, and JSON reports.
- CLI support for individual files, recursive directories, and standard input/output, with overwrite and overlapping-path checks.
- Vite 8 build plugin with chunk filtering and output-stage decoy insertion.
- TypeScript declarations, core and CLI tests, and a Vite fixture with dynamic imports.
- English and Korean usage documentation, contribution and security guidance, and MIT licensing.
- GitHub Actions checks for Node.js 22.12 and 24, covering runtime tests, type declarations, the fixture build, and package contents.

### Changed

- Declared MIT licensing and repository links in package metadata.
- Raised the minimum Node.js version from 20.19 to 22.12 to match the CLI's use of `Array.fromAsync` and the Vite toolchain.
