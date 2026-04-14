# UI Testing D Verification Sync Design

## Scope
- Re-run the UI testing verification set for A/B/C changes already merged on `main`.
- Fix only regressions or small inconsistencies found during verification.
- Sync UI testing docs so checklist, test cases, and Playwright conversion notes match current behavior.

## Approach
- Use a fresh worktree from `origin/main`.
- Run the targeted Playwright specs, repository test contract, and typecheck.
- If verification fails, apply the smallest code/doc change necessary to restore alignment.
- Update affected docs with current automated coverage, manual-only cases, and verification commands.

## Success Criteria
- Targeted E2E for settings/download/history/OS/cancel-retry/cache-breakdown pass.
- `scripts/verify-worktree.sh` and `npx tsc --noEmit` pass.
- UI testing docs no longer describe behavior contradicted by current `main`.
