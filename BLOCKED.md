# Blocked items

## GitHub CLI preflight — 2026-08-03

`gh --version` exited 127 with `/bin/bash: gh: command not found`.

The public repository was created through the authenticated GitHub browser
session instead. Native Git push is still attempted below; no GitHub CLI-based
PR workflow is claimed.
