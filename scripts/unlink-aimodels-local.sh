#!/bin/bash
# Unlink from local aimodels and use published version

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIWRAPPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Unlinking local aimodels..."

cd "$AIWRAPPER_DIR"
npm unlink aimodels 2>/dev/null || true
# Remove symlink if it still exists (workspace handling)
[ -L node_modules/aimodels ] && rm -f node_modules/aimodels
npm install

echo "✓ Now using published aimodels package"

