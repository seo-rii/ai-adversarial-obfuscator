# Contributing

Contributions that improve correctness, compatibility, documentation, or reproducible evaluation are welcome. Use GitHub issues and pull requests for proposed improvements, and follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Development setup

Use Node.js 24 LTS and npm. From the repository root:

```bash
npm ci
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run
npx playwright install chromium --only-shell
npm run test:browser
```

The source is native JavaScript ESM and does not need a compilation step. TypeScript declarations live alongside the implementation in `src/*.d.mts`.

For focused work, `npm run test:unit` checks the core and CLI, and `npm run test:vite` checks Vite policies, reports/budgets, maps, caching, and build behavior. `npm run test:browser` is separate from the Node suite and uses Playwright Chromium to compare original and obfuscated browser/Worker behavior under a strict CSP. On a fresh Linux environment, `npx playwright install --with-deps chromium --only-shell` also installs browser system dependencies; CI runs this check on Node.js 24.

The ordinary fixture build writes under `fixtures/vite/dist/`; browser tests use temporary builds and close their browsers and local servers. Keep generated bundles, reports, package tarballs, and dependency directories out of commits.

## Making a change

1. Describe the problem in an issue, especially before a substantial API or behavior change. Report vulnerabilities through [SECURITY.md](SECURITY.md).
2. Create a branch and keep the change focused on one problem.
3. Add or update behavior tests when the change affects runtime behavior. Execute transformed code, and preserve coverage for deterministic seeds, CLI path safety, native source-map composition, policy/marker consistency, final output metrics, and cache invalidation when those areas change. Read-only CLI plans and checks must remain free of file writes and input execution.
4. Update the public declarations and documentation when an API changes. Keep [README.md](README.md) and [README.ko.md](README.ko.md) consistent.
5. Run the checks above and describe the results in the pull request.

Use conventional commit messages, such as `fix: preserve dynamic imports` or `docs: clarify CLI options`. Follow the existing code style: four spaces, single quotes, and semicolons.

## Evaluation claims

Functional tests check the behavior of selected programs and build configurations. They do not measure LLM resistance or establish a security guarantee. Any proposed effectiveness claim should include a reproducible method, model and version information, evaluation inputs, and limitations. Do not attach another project's results to this implementation.

The current feature work deliberately excludes LLM evaluation and provider calls. Output size, build time, and browser compatibility checks must not be presented as evidence of resistance to LLM analysis.

## License

By submitting a contribution, you agree that it may be distributed under this project's [MIT License](LICENSE). Preserve applicable copyright notices and document the origin and license of third-party material you introduce.
