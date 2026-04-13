#!/usr/bin/env bash
set -euo pipefail

WT_PATH="${1:-$(pwd)}"
VERIFY_SCRIPT="$WT_PATH/scripts/verify-worktree.sh"

if [ -f "$VERIFY_SCRIPT" ]; then
  exit 0
fi

if [ ! -d "$WT_PATH" ]; then
  echo "worktree 경로를 찾을 수 없습니다: $WT_PATH" >&2
  exit 1
fi

cd "$WT_PATH"

if [ ! -f package.json ]; then
  echo "package.json이 없는 저장소는 자동 검증 스크립트 생성을 지원하지 않습니다." >&2
  exit 1
fi

PACKAGE_MANAGER="npm"
if [ -f pnpm-lock.yaml ]; then
  PACKAGE_MANAGER="pnpm"
elif [ -f yarn.lock ]; then
  PACKAGE_MANAGER="yarn"
elif [ -f package-lock.json ]; then
  PACKAGE_MANAGER="npm"
fi

TEST_SCRIPT="$(node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); const test = pkg.scripts && pkg.scripts.test; if (typeof test === 'string') process.stdout.write(test);")"

if [ -z "$TEST_SCRIPT" ]; then
  echo "scripts.test가 없어 verify-worktree.sh를 자동 생성할 수 없습니다." >&2
  exit 1
fi

mkdir -p scripts

cat > scripts/verify-worktree.sh <<EOF
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="\$(cd "\${SCRIPT_DIR}/.." && pwd)"
PACKAGE_MANAGER="${PACKAGE_MANAGER}"
TEST_SCRIPT='${TEST_SCRIPT}'

cd "\$REPO_ROOT"

if [ ! -d node_modules ]; then
  echo "node_modules not found in \$REPO_ROOT. Install dependencies before running verification." >&2
  exit 1
fi

echo "[verify-worktree] package manager: \$PACKAGE_MANAGER"
echo "[verify-worktree] script: \$TEST_SCRIPT"

if [ "\$#" -gt 0 ]; then
  case "\$PACKAGE_MANAGER" in
    pnpm)
      pnpm run test -- "\$@"
      ;;
    yarn)
      yarn test "\$@"
      ;;
    *)
      npm run test -- "\$@"
      ;;
  esac
else
  case "\$PACKAGE_MANAGER" in
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
EOF

chmod +x scripts/verify-worktree.sh
echo "생성 완료: scripts/verify-worktree.sh (${PACKAGE_MANAGER} / scripts.test)"
