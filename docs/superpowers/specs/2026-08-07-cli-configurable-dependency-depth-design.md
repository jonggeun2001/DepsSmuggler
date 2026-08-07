# CLI configurable dependency depth design

## Goal

Fix issue #47: `depssmuggler download`의 기본 의존성 포함 다운로드는
필수 의존성이 설정한 깊이를 초과하더라도 직접 루트 전체를 버리지 않고,
설정된 깊이까지 해결한 패키지를 유지해야 한다.

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

`depssmuggler download --max-depth 8`은 기본 의존성 포함 다운로드에서
깊이 8까지 의존성을 해결한다. 옵션을 생략하면 5를 사용하며, 잘못된 값은
다운로드를 시작하기 전에 명령 옵션 검증 단계에서 실패한다.

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
