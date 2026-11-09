# Changelog

Changes to the project are recorded here. Version entries describe repository development and do not imply publication to npm or the existence of a release tag.

## [Unreleased]

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
