# Contributing to GPT Code

GPT Code is owned and maintained by [zcs2004](https://github.com/zcs2004) in the
[zcs2004/GPT-Code](https://github.com/zcs2004/GPT-Code) repository. The project is developed from
`miuuyy/codex-chatgpt-web`; its authors and contributors remain credited as upstream contributors,
but GPT Code product direction, branding, issue triage, releases, and contribution decisions are
managed independently by the GPT Code maintainer.

Focused contributions are welcome. Good pull requests include isolated bug fixes, regression
tests, localization corrections, documentation improvements, and narrow platform-specific fixes.
Please open a proposal in [GPT Code Issues](https://github.com/zcs2004/GPT-Code/issues) before
starting a large feature, architectural change, provider integration, or broad refactor.

Before opening a bug report, work through [TROUBLESHOOTING.md](TROUBLESHOOTING.md), reproduce the
problem on the latest GPT Code release, and attach only privacy-safe diagnostics. Never publish raw
browser state, cookies, credentials, API keys, tunnel identifiers, private MCP receipts, Codex
history, or unredacted logs.

## Scope and invariants

- Keep the product centered on connecting ChatGPT Web to native Codex through the GPT Code plugin
  and MCP. Do not add a second embedded Codex workbench.
- Model and reasoning selection must remain explicit. Never silently fall back to another model or
  effort level.
- Full harness mode may expose local tools only through the active Codex registry and MCP tunnel.
  Browser-only mode must not silently gain local-tool capabilities.
- Preserve fail-closed behavior. Selector, connector, receipt, or protocol failures must return a
  clear error instead of claiming success.
- User-facing text must use the shared localization system; do not introduce one-language-only UI
  strings.
- Never commit browser profiles, credentials, private keys, generated logs, signing material, or
  absolute user paths.

## Before opening a pull request

1. Install locked dependencies in the repository root and in `launcher/` with
   `bun install --frozen-lockfile`.
2. Run `bun run verify`.
3. Add a focused regression test for behavior changes.
4. For browser DOM, model-selector, or error-state changes, include a sanitized real-UI fixture or
   diagnostic excerpt that demonstrates the affected state.
5. Manually test the affected workflow. DEV simulation is not end-to-end acceptance evidence for
   MCP execution, local tools, updater behavior, or the outer Codex loop.
6. Keep legal, trademark, plan-limit, and model-availability statements factual and independently
   verifiable.

GPT Code release packages target Windows x64 and Linux x64/ARM64. macOS remains source-level CI
compatibility only and is not a published platform. Windows release candidates should be
Authenticode-signed; Linux AppImages and every updater asset must match the published SHA256
manifest. See [release validation](docs/release-validation.md) for the evidence boundary.

By submitting a contribution, you agree that it is provided under the repository's
[Apache License 2.0](LICENSE), unless a file carries a compatible, more specific notice.
