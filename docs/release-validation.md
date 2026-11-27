# Release validation

CI proves that the runtime builds, the launcher starts, and native packages pass their smoke
contract on macOS, Windows, and Linux. It does not prove an authenticated ChatGPT session, a live
MCP connector, or a complete Codex turn. A release candidate is not ready until those account-bound
flows are exercised manually on the published platforms below. macOS is source-level CI coverage
only and is not part of the release matrix.

## Preview releases and updater visibility

Use GitHub's **Set as a pre-release** flag for public test builds. They remain downloadable from
Releases but are excluded from `/releases/latest`, the endpoint used by both existing launchers
and the installer. A draft is private; a pre-release is the public testing option. No separate
launcher update channel or custom release-body flag is required.

The tag workflow creates or reuses a **draft** release, uploads every artifact plus
`checksums.txt`, compares the complete remote asset list and GitHub's SHA-256 digests with the local
manifest, and only then publishes the release. A failed build or verification leaves a hidden draft;
it never exposes a partially uploaded stable release to `/releases/latest`. The workflow refuses to
replace files on an already published tag. Use a new version for changed binaries.

Tags must exactly match the root and Launcher package version (`v1.6.3` for version `1.6.3`). A
suffix such as `v1.6.4-rc.1` is published as a pre-release and remains invisible to the stable
updater. A tag without a suffix is published as the latest stable release only after all gates pass.
Launchers discover it on their next startup update check; already running launchers do not poll.

Before pushing a release tag, configure these GitHub Actions secrets:

- Windows: `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`.

Missing credentials fail the release. Windows verifies the Authenticode signature on both the app
executable and installer and requires one publisher. Linux x64 and arm64 releases are bound to the
same verified SHA-256 manifest as the Windows installer.

The updater also fails closed at runtime. Windows requires the installed app and downloaded
installer to be Authenticode-valid with the same publisher, rechecks the installer in the detached
worker, installs for the current user, and validates the installed executable before relaunching.
Consequently, an old unsigned development build cannot use silent update to cross into the signed
production chain: install the first signed release manually once; subsequent signed releases can
update automatically. Linux updates require the stable installer wrapper and a matching checksum.

GitHub documents this contract in [Get the latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).

## Required evidence

Record the release version, operating-system version, install path (`clean` or `upgrade`), ChatGPT
plan, Codex version, result of each check, and a redacted Activity log for every failure. Never
capture cookies, tunnel IDs, API keys, bearer tokens, or prompt contents.

## Windows 11 gate

Run this list on a maintained Windows 11 x64 machine with a real ChatGPT account:

1. Install the packaged launcher on a clean profile and prove that the embedded Bun runtime starts.
2. Sign in inside the embedded browser and prove that a new ordinary chat reaches a usable composer.
3. Install the Codex model route, restart Codex, and prove that every account-available ChatGPT Web
   effort appears exactly once without removing native models.
4. Complete one Browser-only turn and verify streamed commentary plus the final answer.
5. Configure the `Codex Native2` connector, run **Verify runtime**, and complete one Full-mode local
   tool turn. Repeat with Pro when the account exposes Pro.
6. Drive a chat past the compaction threshold and prove that it continues after compaction without
   a duplicate or orphaned browser turn.
7. On a clean install, prove that setup offers both interaction modes and defaults to With
   Automation. Select Zero Risk and prove that Codex shows exactly one generic Web model after
   restart, a retained chat receives only the next prompt, and
   compaction completes through MCP before the compacted continuation opens a fresh manual chat.
   Inspect the copied prompt and prove that it contains only the current `request_id`, never a
   surface nonce, capability token, or prompt-level lifecycle commands.
   Switch back to Automatic and prove that the account-visible catalog is restored.
8. Cancel a running turn by closing its launcher tab, then cancel another with the launcher action;
   prove that neither turn recreates a tab or keeps the runtime busy.
9. Quit the launcher during an active turn, confirm the explicit cancellation path, reopen it, and
   prove that the saved ChatGPT session and Codex route are still valid.
10. Prove Codex Voice can create a WebRTC call while Responses use the local bridge. Disconnect the
   bridge and prove that both exact previous route assignments are restored; reconnect it and prove
   that the existing private MCP credentials are reused rather than replaced.
11. Upgrade from the previous public release and prove that launcher state, browser state, Codex
    settings, and MCP configuration survive the updater transaction.

Any failed or unexecuted item blocks a stable release. An alpha may ship with a named failed item
only when the release notes describe the limitation and recovery path explicitly.

### v3.0.0 result

Maintainer validation passed on Windows 11 x64 on 2026-08-22 using the published v3.0.0-alpha
upgrade package and a real ChatGPT Pro account. The authenticated launcher, Codex model catalog,
Full-mode MCP tools, Pro turns, compaction, cancellation, session reuse, and preserved connector
configuration were exercised successfully. The direct installer completed successfully but gave no
clear completion action; v3.0.0 changes it to an assisted installer with a final launch option.

## macOS non-release CI

macOS remains in ordinary CI to catch source and packaging regressions, but no macOS installer or
runtime archive is uploaded by the Release workflow. A passing macOS CI job is not release support.

## Linux gate

CI packaging smoke is required. Before claiming interactive Linux support for a release, repeat
items 2 through 7 under a supported desktop session and record the display server and packaging
format used.
