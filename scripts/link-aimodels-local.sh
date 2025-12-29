#!/bin/bash
# Link to local aimodels package for testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIWRAPPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AIMODELS_PATH="$(cd "$AIWRAPPER_DIR/../aimodels/js" && pwd)"

if [ ! -d "$AIMODELS_PATH" ]; then
  echo "Error: aimodels directory not found at $AIMODELS_PATH"
  exit 1
fi

echo "Linking local aimodels from $AIMODELS_PATH..."
cd "$AIMODELS_PATH"
npm link

cd "$AIWRAPPER_DIR"
npm link aimodels

echo "✓ Linked to local aimodels package"
echo "To switch back: npm run aimodels:unlink"

