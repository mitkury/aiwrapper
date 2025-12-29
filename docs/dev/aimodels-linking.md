# Linking Local AIModels Package

## Purpose

When new models are added to the `aimodels` package, you may want to test them in `aiwrapper` before publishing `aimodels` to npm. This workflow allows you to quickly link your local `aimodels` development version for testing new models.

## How It Works

We use npm's `link` mechanism, which creates symlinks in `node_modules` instead of modifying `package.json`. This ensures:

- **No accidental commits**: `package.json` remains unchanged, so you won't accidentally commit a local file path
- **Quick switching**: Toggle between local and published versions with a single command
- **Safe**: The version in `package.json` reflects what will be installed for others and in CI

## Requirements

The `aimodels` repository must be located at the same directory level as `aiwrapper`. The scripts expect `aimodels` at `../aimodels/js` relative to the `aiwrapper` repository root.

For example:
```
repos/
  ├── aiwrapper/
  └── aimodels/
      └── js/
```

## Usage

```bash
# Link to local aimodels package
npm run aimodels:link

# Test new models in aiwrapper...

# Switch back to published version
npm run aimodels:unlink
```

## What Happens

**When linking:**
1. The local `aimodels` package is registered globally via `npm link`
2. A symlink is created in `node_modules/aimodels` pointing to your local package
3. The `"aimodels": "^0.5.2"` entry in `package.json` is ignored while the link is active
4. New models in your local `aimodels` package are immediately available for testing (rebuild aimodels if it has a build step)

**When unlinking:**
1. The symlink is removed
2. The published version from npm is reinstalled according to `package.json`
3. Normal npm dependency resolution resumes

## Implementation

The scripts are located in `scripts/`:
- `scripts/link-aimodels-local.sh` - Creates the link
- `scripts/unlink-aimodels-local.sh` - Removes the link and reinstalls from npm

