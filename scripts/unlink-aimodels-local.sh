#!/bin/bash
# Unlink from local aimodels and use published version

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIWRAPPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Unlinking local aimodels..."

cd "$AIWRAPPER_DIR"
# Reinstall exactly what package-lock.json records. Unlike `npm unlink`, this
# does not remove aimodels from package.json or rewrite the lockfile.
npm ci

echo "✓ Now using published aimodels package"
