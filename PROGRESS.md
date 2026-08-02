# MVP 1.0 progress

- Goal: publish auditable code while keeping the personal Markdown vault private.
- Order: lock down ignored data, build the D1-backed private workbench, validate, then publish and deploy.
- Baseline on 2026-08-03: Python tests 91 passed / 1 skipped; local lint passed; Web tests 2 passed; Web lint passed.
- Largest risk: GitHub CLI/authentication and deployment credentials are not present locally.
- The online Alpha starts empty and does not import material from `thinking/`.
- Privacy reverse check: `git check-ignore -v thinking/active-questions.md` identifies root `.gitignore`.
- Validation reverse check: an inverted missing-scenario assertion failed with `intentional reverse check: missing scenario was rejected`; the restored check passed with `validationScenario is required for validate_in_context`.
- Web implementation: D1 schema and migration generated; build, 5 Web tests, and lint pass when run sequentially.
- GitHub CLI is absent, but the authenticated browser created the public `ElienTdog/thinking-intelligence-mvp` repository. The local Git author will use that account's public noreply identity only for this repository.
- A real private-site write uncovered and fixed an async React form-reset bug before the final verification pass.
