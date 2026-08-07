# CLI configurable dependency depth design

## Goal

Fix issue #47: a `depssmuggler download --deps` run must keep the packages
resolved up to the configured dependency depth instead of dropping the entire
direct root when a required dependency would exceed that boundary.

## Scope

- Add `--max-depth <number>` to the CLI `download` command.
- Keep `5` as the default to preserve existing bounded-resolution behaviour.
- Accept only non-negative integers.
- Forward the value through the CLI preparation flow to
  `resolveAllDependencies`.
- For pip resolution, retain packages through the limit and stop expanding a
  boundary package's children. Emit a warning; do not report the direct root as
  unresolved solely because of the configured boundary.
- Update focused tests and the CLI/resolver documentation.

## Non-goals

- Changing the default depth.
- Removing depth limits or making resolution unbounded.
- Changing non-pip resolver depth semantics beyond receiving the CLI option.
- Changing strict handling for genuine metadata, version, compatibility, or
  network resolution failures.

## Design

### CLI contract

`depssmuggler download --deps --max-depth 8` resolves dependencies through
depth 8. Omitting the option uses 5. Invalid values fail command-option
validation before downloads begin.

### Resolution flow

The command's parsed `maxDepth` is passed to `resolveAllDependencies`. That
value is then supplied to the package-specific resolver exactly as today.

Pip resolution distinguishes two conditions:

1. A genuine required dependency cannot be resolved: preserve the existing
   direct-root failure policy.
2. A required dependency would only be visited beyond `maxDepth`: retain the
   current node, do not enqueue descendants, and return the partial tree/list.

The resulting package list contains every artifact discovered through the
limit. A warning makes the omitted descendants observable without converting
the run into a root-resolution error.

### Tests and documentation

- CLI command tests verify the default and explicit option are forwarded.
- Pip resolver characterization tests verify a bounded tree returns the
  resolvable prefix rather than throwing.
- CLI documentation explains the option, default, and partial-result warning.
- Resolver documentation records the boundary semantics and distinguishes them
  from actual dependency-resolution failures.

## Verification

Run the targeted CLI and pip resolver tests, then the worktree verification
script, lint/format checks as relevant, and inspect the resulting CLI help.
