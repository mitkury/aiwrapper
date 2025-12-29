#!/bin/bash
# Unlink from local aimodels and use published version

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIWRAPPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Unlinking local aimodels..."

cd "$AIWRAPPER_DIR"
npm unlink aimodels 2>/dev/null || true
npm install aimodels@^0.5.2

echo "✓ Now using published aimodels package"

