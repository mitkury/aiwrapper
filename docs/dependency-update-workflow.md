# Dependency Update Workflow

## Overview

When aimodels is updated and released, it automatically triggers dependency updates in aiwrapper through GitHub Actions workflows. This ensures that aiwrapper stays up-to-date with the latest aimodels version and automatically publishes a new patch version.

## Workflow Steps

1. **AIModels Release**
   - When a new version of aimodels is released
   - The `trigger-aiwrapper-update.yml` workflow is automatically triggered
   - It sends a repository dispatch event to aiwrapper with the new version

2. **AIWrapper Update**
   - AIWrapper receives the `aimodels-package-updated` event
   - The `update-aimodels-dependency.yml` workflow:
     - Updates the aimodels dependency to the new version
     - Commits changes directly to the main branch
     - Creates a new patch version of aiwrapper
     - Publishes the new version to npm

## Configuration

### Required Secrets
- `REPO_ACCESS_TOKEN`: A GitHub token with permissions to:
  - Trigger repository dispatch events
  - Push to repositories
- `NPM_TOKEN`: An npm token with publish permissions

### Workflow Details

#### In AIModels (`trigger-aiwrapper-update.yml`)
- Triggers on:
  - New releases (automatically)
  - Manual workflow dispatch with version input
- Sends a repository dispatch event to `mitkury/aiwrapper` with:
  - Event type: `aimodels-package-updated`
  - Payload: `{ "version": "x.y.z" }`

#### In AIWrapper (`update-aimodels-dependency.yml`)
- Updates the aimodels dependency
- Commits changes directly to main
- Creates a new patch version
- Pushes tags to GitHub
- Publishes the new version to npm

## Manual Trigger

The workflow can be manually triggered through the GitHub Actions UI:
1. Go to the Actions tab in aimodels
2. Select "Trigger AIWrapper Update"
3. Enter the version to update to
4. Click "Run workflow" 