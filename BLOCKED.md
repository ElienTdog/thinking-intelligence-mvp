# Blocked items

## GitHub CLI preflight — 2026-08-03

`gh --version` exited 127 with `/bin/bash: gh: command not found`.

The public repository was created through the authenticated GitHub browser
session instead. Native Git push is still attempted below; no GitHub CLI-based
PR workflow is claimed.

## Private Sites deployment attempt 1 — 2026-08-03

Saved version 1 failed only at production certificate provisioning:
`Timed out waiting for the TLS certificate for thinking-intelligence-alpha.zyxelient.chatgpt.site`.

The build, source push, D1 migration archive, and owner-only access-policy checks completed before this platform failure. Two deployment retries remain before stopping.
