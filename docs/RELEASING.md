# Releasing

Step-by-step guide for creating new releases of gha-opencache.

## Versioning Strategy

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (v2.0.0): Breaking changes to action inputs/outputs or behavior
- **MINOR** (v1.1.0): New features, backward compatible
- **PATCH** (v1.0.1): Bug fixes, backward compatible

For GitHub Actions, we also maintain a **floating major tag** (e.g., `v1`) that always points to the latest release in that major version. Users reference `@v1` to automatically get compatible updates.

## Prerequisites

1. **Push access** to the repository
2. **GitHub CLI** (`gh`) installed and authenticated
3. All CI checks passing on `main` branch
4. Working directory is clean (no uncommitted changes)

## Release Checklist

### 1. Ensure Main is Up to Date

```bash
git checkout main
git pull origin main
```

### 2. Verify CI Status

```bash
gh run list --branch main --limit 5
```

All recent runs should show success (green checkmark).

### 3. Determine Version Number

Check existing tags:

```bash
git tag --list 'v*' | sort -V
```

Choose the next version based on changes since last release:

- Bug fixes only: bump PATCH (v1.0.0 -> v1.0.1)
- New features: bump MINOR (v1.0.0 -> v1.1.0)
- Breaking changes: bump MAJOR (v1.0.0 -> v2.0.0)

### 4. Update package.json Version (if needed)

If the version in `package.json` should match the release:

```bash
npm version <major|minor|patch> --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to vX.Y.Z"
git push origin main
```

### 5. Generate Release Notes

List changes since last release:

```bash
# Replace v1.0.0 with your last release tag
git log v1.0.0..HEAD --oneline --no-merges
```

Or view merged PRs:

```bash
gh pr list --state merged --base main --limit 20
```

### 6. Create the Release

Replace `X.Y.Z` with your version number:

```bash
# Create and push the version tag
git tag vX.Y.Z
git push origin vX.Y.Z

# Create GitHub release with auto-generated notes
gh release create vX.Y.Z --generate-notes --title "vX.Y.Z"
```

For releases with custom notes:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(cat <<'EOF'
## What's Changed

- Feature: Description of feature (#PR)
- Fix: Description of fix (#PR)

**Full Changelog**: https://github.com/amulya-labs/gha-opencache/compare/vPREV...vX.Y.Z
EOF
)"
```

### 7. Update Major Version Tag

Update the floating major version tag (e.g., `v1`) to point to the new release:

```bash
# Delete the old major tag locally and remotely
git tag -d v1
git push origin :refs/tags/v1

# Create new major tag pointing to the release
git tag v1 vX.Y.Z
git push origin v1

# Update the GitHub release for the major tag
gh release edit v1 --tag v1 --title "v1" --notes "Latest v1.x release. See [vX.Y.Z](https://github.com/amulya-labs/gha-opencache/releases/tag/vX.Y.Z) for details."
```

If the `v1` release does not exist yet:

```bash
gh release create v1 --title "v1" --notes "Latest v1.x release. See [vX.Y.Z](https://github.com/amulya-labs/gha-opencache/releases/tag/vX.Y.Z) for details." --latest
```

### 8. Verify the Release

```bash
# List releases
gh release list

# View the new release
gh release view vX.Y.Z

# Verify tags
git tag --list 'v*'
```

### 9. Post-Release Verification

Test that the action works with the new tag:

```yaml
# In a test workflow
- uses: amulya-labs/gha-opencache@vX.Y.Z
  with:
    path: test-dir
    key: test-${{ github.sha }}
```

## Quick Reference

### Complete Release Script

For a patch release (e.g., v1.0.0 -> v1.0.1):

```bash
# Variables - update these
NEW_VERSION="1.0.1"
MAJOR_VERSION="1"

# Create release
git checkout main && git pull origin main
git tag v${NEW_VERSION}
git push origin v${NEW_VERSION}
gh release create v${NEW_VERSION} --generate-notes --title "v${NEW_VERSION}"

# Update major tag
git tag -d v${MAJOR_VERSION}
git push origin :refs/tags/v${MAJOR_VERSION}
git tag v${MAJOR_VERSION} v${NEW_VERSION}
git push origin v${MAJOR_VERSION}
gh release edit v${MAJOR_VERSION} --tag v${MAJOR_VERSION} --title "v${MAJOR_VERSION}" --notes "Latest v${MAJOR_VERSION}.x release. See [v${NEW_VERSION}](https://github.com/amulya-labs/gha-opencache/releases/tag/v${NEW_VERSION}) for details."
```

### Emergency Hotfix

If a critical bug is found in a release:

```bash
# Create hotfix from the release tag
git checkout -b hotfix/description vX.Y.Z

# Make fixes, then:
git commit -m "fix: description of fix"
git push origin hotfix/description

# Create PR, merge, then release new patch version
```

## Troubleshooting

### Tag Already Exists

```bash
# Delete local tag
git tag -d vX.Y.Z

# Delete remote tag
git push origin :refs/tags/vX.Y.Z

# Recreate
git tag vX.Y.Z
git push origin vX.Y.Z
```

### Release Created with Wrong Tag

```bash
# Delete the release
gh release delete vX.Y.Z --yes

# Delete and recreate tag if needed
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z

# Start over from step 6
```

### CI Failed After Tagging

If CI fails after you have created a tag but before creating the release:

1. Delete the tag: `git push origin :refs/tags/vX.Y.Z`
2. Fix the issue on main
3. Start over from step 1

## Release Cadence

- **Patch releases**: As needed for bug fixes
- **Minor releases**: When new features are ready
- **Major releases**: Rare, only for breaking changes

There is no fixed schedule. Releases happen when there are meaningful changes to ship.
