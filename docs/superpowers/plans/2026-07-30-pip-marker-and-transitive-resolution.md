# Pip Marker And Transitive Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent incomplete pip bundles by propagating required transitive-resolution failures to their direct root, evaluate PEP 508 markers using the requested target environment, and preserve packages owned by successful roots when another direct root fails.

**Architecture:** Keep target-aware dependency behavior in `PipResolver`. Extend the shared resolver result with explicit successful-root ownership, then have the CLI use that ownership instead of filtering final packages by failed root name/version. Treat unsupported marker syntax and unavailable platform values as false.

**Tech Stack:** TypeScript, Vitest, Commander CLI, existing PyPI Simple API and JSON metadata clients.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/resolver/pip-resolver.ts` | Resolve required descendants, PEP 658/JSON metadata availability, markers, and extras per direct root. |
| `src/core/resolver/pip-resolver.test.ts` | Unit coverage for resolver failure propagation, metadata fallback, markers, and repeated extras. |
| `src/core/resolver/pip-resolver.characterization.test.ts` | Regression coverage for target-specific resolver behavior. |
| `src/core/shared/dependency-resolver.ts` | Record package ownership for each successful direct-root resolution. |
| `src/core/shared/dependency-resolver.test.ts` | Test successful-root ownership when sibling roots fail. |
| `src/cli/commands/download.ts` | Package only artifacts belonging to successful direct roots. |
| `src/cli/commands/download.test.ts` | Verify CLI best-effort and strict behavior with shared/transitive packages. |
| `docs/superpowers/specs/2026-07-30-pip-marker-and-transitive-resolution-design.md` | Keep the accepted behavior specification aligned with the implementation. |

## Task 1: Preserve Successful Direct-Root Ownership

**Files:**
- Modify: `src/core/shared/dependency-resolver.ts`
- Modify: `src/core/shared/dependency-resolver.test.ts`
- Modify: `src/cli/commands/download.ts`
- Modify: `src/cli/commands/download.test.ts`

- [x] Add failing shared-resolver tests where two direct roots resolve the same normalized package identity and one root fails; assert that the package remains available for the successful root.
- [x] Add failing CLI tests for default best-effort and `--strict`: default packages only successful root closures, while strict still fails before creating an archive.
- [x] Extend the resolver result with normalized package identities or package lists owned by each successful direct root. Build this from each successful `resolveDependencies` call rather than from a global aggregate alone.
- [x] Update the CLI to select packages from successful-root ownership and remove the failed-root name/version exclusion that can discard a shared dependency.
- [x] Run `npm run test -- --run src/core/shared/dependency-resolver.test.ts src/cli/commands/download.test.ts`.
- [x] Commit: `fix: retain packages owned by successful roots`

## Task 2: Fail a Direct Root When a Required Descendant Cannot Resolve

**Files:**
- Modify: `src/core/resolver/pip-resolver.ts`
- Modify: `src/core/resolver/pip-resolver.characterization.test.ts`

- [x] Add failing resolver tests for a required child with no satisfying version, a required child whose metadata fetch fails, and a required child blocked by `maxDepth`.
- [x] Add a regression test proving an incompatible child release is not selected as a fallback for an unsatisfied requirement.
- [x] Introduce a resolution error carrying the parent/child requirement context. Propagate it through the active direct-root resolution instead of logging and omitting the child.
- [x] Define the depth boundary so a dependency that would need expansion beyond `maxDepth` fails the direct root, while valid leaves within the boundary remain valid.
- [x] Preserve existing behavior for optional dependencies excluded by markers; they must not create resolution failures.
- [x] Run `npm run test -- --run src/core/resolver/pip-resolver.test.ts`.
- [x] Commit: `fix: fail pip roots with unresolved required dependencies`

## Task 3: Establish Dependency Metadata or Fail

**Files:**
- Modify: `src/core/resolver/pip-resolver.ts`
- Modify: `src/core/resolver/pip-resolver.test.ts`
- Modify: `src/core/shared/pip-simple-api-client.ts`
- Create: `src/core/shared/pip-simple-api-client.test.ts`

- [x] Add failing tests for selected Simple API artifacts that advertise PEP 658 metadata but cannot load it, and for artifacts without inline metadata where the PyPI JSON fallback cannot establish `Requires-Dist`.
- [x] Add a control test confirming that successfully read metadata with an empty `Requires-Dist` list is a valid leaf.
- [x] Add shared Simple API client tests that distinguish a successful PEP 658 response with no `Requires-Dist` entries from an unavailable or failed PEP 658 metadata response.
- [x] Change the shared metadata-fetch result to represent established metadata separately from unavailable/error metadata; preserve callers that only need a parsed dependency list.
- [x] Use PEP 658 metadata when advertised, otherwise use the public PyPI JSON fallback; raise the required-resolution error when neither source establishes dependency metadata.
- [x] Run `npm run test -- --run src/core/resolver/pip-resolver.characterization.test.ts src/core/shared/pip-simple-api-client.test.ts`.
- [x] Commit: `fix: require pip dependency metadata for resolved artifacts`

## Task 4: Evaluate PEP 508 Markers and Merge Extras Per Root

**Files:**
- Modify: `src/core/resolver/pip-resolver.ts`
- Modify: `src/core/resolver/pip-resolver.test.ts`
- Modify: `src/core/resolver/pip-resolver.characterization.test.ts`

- [x] Add failing marker tests for `python_full_version`, `implementation_version`, `os_name`, `platform_python_implementation`, and `implementation_name` using a non-host target.
- [x] Add failing tests for `in`/`not in`, reversed literal-variable comparisons, unavailable `platform_release`/`platform_version`, and unsupported syntax. Assert unknown or unavailable conditions evaluate false.
- [x] Add failing tests where multiple paths request distinct extras for the same name@version in one direct-root tree. Assert extras are unioned and the package is re-expanded when a new extra is discovered.
- [x] Add a test proving extras from one direct root cannot enable dependencies for a separately resolved direct root.
- [x] Build a target marker environment from explicit Python version, normalized platform/architecture, and the fixed CPython resolver identity. Compare version-valued variables with PEP 440 semantics and all other supported values as strings.
- [x] Track resolved package state by normalized name@version plus an extras set local to one `resolveDependencies` call; retain the empty set and reprocess only on newly added extras.
- [x] Run `npm run test -- --run src/core/resolver/pip-resolver.test.ts src/core/resolver/pip-resolver.characterization.test.ts`.
- [x] Commit: `fix: evaluate pip markers against target environment`

## Task 5: Integrate, Verify, and Review

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-pip-marker-and-transitive-resolution-design.md` only if implementation reveals an approved-spec ambiguity.
- Modify: `docs/cli.md`
- Modify: `docs/resolvers.md`
- Modify: pull request description after source verification.

- [ ] Run focused tests from Tasks 1-4, then `npm run test`, `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Update CLI and resolver documentation with the direct-root failure policy and supported marker evaluation boundary.
- [ ] Run a real Python 3.12 CLI `--deps` download for a package with transitive dependencies and inspect the archive contents and summary.
- [ ] Review the final diff for behavior outside the accepted specification and update the PR description with exact verification results.
- [ ] Push the branch and wait for all required GitHub Actions checks.
- [ ] Run the independent review gate on the final PR diff. Address findings and repeat verification/review until it reports PASS.
- [ ] Squash-merge only after required CI and the independent review gate pass; then remove the merged branch and worktree while leaving unrelated worktrees and files untouched.
