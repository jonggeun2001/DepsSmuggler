#!/usr/bin/env bash
set -euo pipefail

WT_PATH="${1:-$(pwd)}"
VERIFY_SCRIPT="$WT_PATH/scripts/verify-worktree.sh"

if [ -f "$VERIFY_SCRIPT" ]; then
  exit 0
fi

mkdir -p "$WT_PATH/scripts"

cat <<'EOF' > "$VERIFY_SCRIPT"
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d node_modules ]; then
  echo "node_modules not found in $ROOT. Install dependencies before running verification." >&2
  exit 1
fi

npm run test -- electron/download-handlers.test.ts
npx playwright test tests/e2e/os-package-download.spec.ts --project=chromium
EOF

chmod +x "$VERIFY_SCRIPT"
