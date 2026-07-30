# Pip Marker And Transitive Resolution Design

## Goal

Prevent pip CLI archives from silently omitting required transitive dependencies and evaluate package metadata markers against the selected target environment. The resolver must only return a successful root when every required, applicable dependency was resolved.

## Scope

- Propagate an applicable transitive dependency resolution failure to the direct root package.
- Evaluate standard PEP 508 marker values that can be derived from the existing target OS, architecture, Python version, and selected extras.
- Treat unsupported marker syntax or values that cannot be derived from the selected target as false.
- Preserve the existing best-effort policy at the CLI boundary: a failed direct root is skipped by default and fails the command with `--strict`.

## Non-Goals

- Add a third-party PEP 508 parser dependency.
- Invent target values for `platform_release` or `platform_version`.
- Change archive packaging behavior or add private registry authentication.

## Design

### Required Transitive Dependencies

After parsing and marker-filtering `Requires-Dist`, every remaining dependency is required. If no version satisfies its specifier, fetching its metadata fails, or resolution reaches `maxDepth` while another applicable dependency remains, the resolver throws a dependency-resolution error that identifies the parent and child package. Pip resolution no longer substitutes an incompatible fallback version for a required specifier; a fallback is only valid when it satisfies the specifier. `resolveAllDependencies` already turns a resolver error into a failed direct root; the CLI then follows its existing best-effort or `--strict` policy. Marker-filtered dependencies remain optional for the current target and do not cause a failure.

For a custom Simple API artifact, advertised PEP 658 metadata must be fetched and parsed successfully. When PEP 658 metadata is not advertised, the resolver attempts the public PyPI metadata fallback. If neither source can establish `Requires-Dist`, resolution fails rather than assuming an empty dependency list. A successfully fetched empty `Requires-Dist` remains a valid dependency-free package.

### Marker Environment

The resolver derives immutable target values for a resolution run:

| Marker | Source |
| --- | --- |
| `python_version` | Selected Python `major.minor` |
| `python_full_version`, `implementation_version` | Selected Python version including patch when supplied |
| `os_name` | `posix` for Linux/macOS, `nt` for Windows |
| `sys_platform` | `linux`, `darwin`, or `win32` |
| `platform_system` | `Linux`, `Darwin`, or `Windows` |
| `platform_machine` | Normalized selected architecture |
| `platform_python_implementation` | `CPython` |
| `implementation_name` | `cpython` |
| `extra` | The extras requested for the package currently being expanded, or an empty value |

`platform_release` and `platform_version` are deliberately unavailable because the application does not collect target OS release information. A marker using an unavailable value evaluates to false. `extra` is the only package-scoped value: root extras do not leak to descendants, and a dependency declared as `child[foo]` evaluates `child` requirements with `foo`.

### Marker Evaluation

The existing parenthesis and `and`/`or` expression handling remains. Atomic conditions support equality, inequality, ordered comparison, `in`, and `not in`, including quoted-literal and marker-variable operands. Version-valued markers use the existing PEP 440 comparison helper; string-valued markers use exact or membership comparisons. Parsing failures, unsupported variables, unavailable values, and unsupported operators are false. This fail-closed rule prevents an archive from receiving packages that were not requested for the selected target.

### Tests And Documentation

Regression coverage will verify:

- A missing, incompatible, metadata-unavailable, or depth-limited required child makes its direct root fail, allowing CLI best-effort mode to skip that root and `--strict` to fail.
- The newly supported marker variables and `in`/`not in` select or exclude dependencies for a Linux CPython target.
- Unknown variables, unavailable target values, and malformed conditions are excluded.
- Existing `python_version` patch handling remains `major.minor`, while `requires_python` continues to use the full version.

`docs/cli.md` and `docs/resolvers.md` will document the failure policy and marker evaluation boundary.

## Verification

- Targeted red/green Vitest cases for the new resolver branches.
- Full `npm run test -- --silent`, `npm run lint`, `npm run build`, and `git diff --check`.
- A real PyPI CLI download after the build.
- The worktree-flow independent review gate, CI, squash merge, and worktree cleanup.
