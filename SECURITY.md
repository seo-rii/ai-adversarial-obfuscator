# Security policy

## Versions

The `0.1.x` line is in initial development and is the current target for fixes. Older versions have no separate maintenance commitment. See [VALIDATION.md](VALIDATION.md) for the configurations and checks actually exercised.

## Reporting a vulnerability

Send suspected vulnerabilities to [me@seorii.page](mailto:me@seorii.page). Include the affected version or commit, Node.js and dependency versions, a minimal reproduction, and the expected impact. Remove credentials, private source code, and other sensitive data from examples.

Use email for the initial report rather than a regular issue or pull request. The maintainer will coordinate any fix and disclosure with the reporter; there is no guaranteed response time or bounty program.

## Scope and limitations

Reports about unsafe file handling, untrusted option handling, unexpected code execution during transformation, or disclosure of original source are relevant. A report should distinguish a defect in this project from a vulnerability in a dependency.

Obfuscation does not make client-side code confidential. Comments and unreachable decoys can be removed by normalization or rebundling, and determined analysts can inspect code at runtime. Keep secrets out of distributed JavaScript.

This implementation has no measured LLM resistance or attack success rate. Functional checks do not establish compatibility with every browser, Content Security Policy, or framework. Test transformed output in the application and runtime where it will be used.
