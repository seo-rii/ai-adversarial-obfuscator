# Implementation validation (2026-11-08)

Environment used for the verification:

- Linux, Node.js 24.22.1, npm 11.9.0
- Vite 8.3.6 (Rolldown)
- javascript-obfuscator 5.10.0
- TypeScript 7.0.2

Commands:

```bash
npm ci --no-audit --no-fund
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run
```

The automated suite checks actual Node.js CJS execution, Node ESM imports and a Vite production build with a working dynamic `import()`. It compares results from protected and unprotected builds. It also verifies persistence of final decoy comments and inert code, file hash changes, CLI safety checks and configuration errors.

An installable npm tarball was generated with `npm pack`, installed into a separate directory, and its CLI and package module exports were invoked successfully.

This is functional verification, **not a security guarantee**. It does not measure resistance to current LLMs, browser-specific compatibility, CSP compatibility or real-world reverse-engineering cost. Source maps are deliberately disabled.
