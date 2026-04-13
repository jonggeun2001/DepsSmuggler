#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_MANAGER="npm"
TEST_SCRIPT='vitest run'

cd "$REPO_ROOT"

if [ ! -d node_modules ]; then
  echo "node_modules not found in $REPO_ROOT. Install dependencies before running verification." >&2
  exit 1
fi

echo "[verify-worktree] package manager: $PACKAGE_MANAGER"
echo "[verify-worktree] script: $TEST_SCRIPT"

if [ "$#" -gt 0 ]; then
  case "$PACKAGE_MANAGER" in
    pnpm)
      pnpm run test -- "$@"
      ;;
    yarn)
      yarn test "$@"
      ;;
    *)
      npm run test -- "$@"
      ;;
  esac
else
  case "$PACKAGE_MANAGER" in
    pnpm)
      pnpm run test
      ;;
    yarn)
      yarn test
      ;;
    *)
      npm run test
      ;;
  esac
fi
