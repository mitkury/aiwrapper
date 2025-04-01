# Automated updates

AIWrapper uses GitHub Actions workflows to automate dependency management and releases; [.github/workflows/update-aimodels-dependency.yml](../../.github/workflows/update-aimodels-dependency.yml).

### Workflow overview

The automated process follows these steps:

1. When a dependency is updated (particularly the `aimodels` package), a webhook triggers the workflow
2. The workflow automatically updates the dependency in the AIWrapper project
3. Changes are committed to the repository
4. A new patch version is created and tagged
5. The updated package is published to npm

This automation ensures that AIWrapper stays current with its dependencies without requiring manual intervention. The process maintains consistency between related packages and simplifies the release cycle. 

### Why not dependabot?

While Dependabot is a popular solution for dependency management, we use a custom workflow for the `aimodels` package because:

- Dependabot runs on a schedule with periodic checks, but we need to update immediately when a new version of `aimodels` is published
- Our webhook-based approach ensures we can react instantly to updates in related packages