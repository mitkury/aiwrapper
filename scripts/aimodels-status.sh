#!/bin/bash
# Show which aimodels version is in use and whether it's linked.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIWRAPPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$AIWRAPPER_DIR"

if [ ! -d "node_modules/aimodels" ]; then
  echo "aimodels is not installed"
  exit 0
fi

VERSION=""
if [ -f "node_modules/aimodels/package.json" ]; then
  VERSION="$(node -p "require('./node_modules/aimodels/package.json').version")"
fi

if [ -n "$VERSION" ]; then
  echo "aimodels version: $VERSION"
else
  echo "aimodels version: unknown"
fi

if [ -L "node_modules/aimodels" ]; then
  LINK_PATH="$(cd "node_modules/aimodels" && pwd -P)"
  echo "aimodels is linked: yes"
  echo "linked path: $LINK_PATH"
else
  echo "aimodels is linked: no"
fi
