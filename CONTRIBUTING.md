# Contributing

Contributions that improve correctness, compatibility, documentation, or reproducible evaluation are welcome. This repository is currently private; GitHub issues and pull requests are available to people with repository access.

## Development setup

Use Node.js 24 LTS and npm. From the repository root:

```bash
npm ci
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run
```

The source is native JavaScript ESM and does not need a compilation step. TypeScript declarations live alongside the implementation in `src/*.d.mts`.

For focused work, `npm run test:unit` checks the core and CLI, and `npm run test:vite` checks Vite integration. The fixture build writes generated files under `fixtures/vite/dist/`; keep generated bundles, reports, package tarballs, and dependency directories out of commits.

## Making a change

1. Describe the problem in an issue, especially before a substantial API or behavior change. Report vulnerabilities through [SECURITY.md](SECURITY.md).
2. Create a branch and keep the change focused on one problem.
3. Add or update behavior tests when the change affects runtime behavior. Check transformed code by executing it, and preserve coverage for deterministic seeds, CLI input safety, and Vite output hooks when those areas change.
4. Update the public declarations and documentation when an API changes. Keep [README.md](README.md) and [README.ko.md](README.ko.md) consistent.
5. Run the checks above and describe the results in the pull request.

Use conventional commit messages, such as `fix: preserve dynamic imports` or `docs: clarify CLI options`. Follow the existing code style: four spaces, single quotes, and semicolons.

## Evaluation claims

Functional tests check the behavior of selected programs and build configurations. They do not measure LLM resistance or establish a security guarantee. Any proposed effectiveness claim should include a reproducible method, model and version information, evaluation inputs, and limitations. Do not attach another project's results to this implementation.

## License

By submitting a contribution, you agree that it may be distributed under this project's [MIT License](LICENSE). Preserve applicable copyright notices and document the origin and license of third-party material you introduce.
