# Releasing

Requires: [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with push access.

## Quick Reference

#### Define Versions
```bash
# === RELEASE SCRIPT ===
# Update these variables for your release
NEW_VERSION="1.0.1"
MAJOR_VERSION="1"
```

#### Create Release
```bash
# Ensure main is up to date
git checkout main && git pull origin main

# Verify CI is green
gh run list --branch main --limit 3

# Create and push version tag
git tag v${NEW_VERSION}
git push origin v${NEW_VERSION}

# Create GitHub release with auto-generated notes
gh release create v${NEW_VERSION} --generate-notes --title "v${NEW_VERSION}"

# Update floating major tag (e.g., v1 -> points to v1.0.1)
git tag -d v${MAJOR_VERSION} 2>/dev/null
git push origin :refs/tags/v${MAJOR_VERSION} 2>/dev/null
git tag v${MAJOR_VERSION} v${NEW_VERSION}
git push origin v${MAJOR_VERSION}

# Verify
gh release view v${NEW_VERSION}
```

## Versioning

- **MAJOR** (`v2.0.0`): Breaking changes
- **MINOR** (`v1.1.0`): New features, backward compatible
- **PATCH** (`v1.0.1`): Bug fixes

Users reference `@v1` (floating tag) to get compatible updates automatically.

## Choosing a Version

```bash
# Check existing tags
git tag --list 'v*' | sort -V

# View changes since last release
git log v1.0.0..HEAD --oneline --no-merges

# Or view merged PRs
gh pr list --state merged --base main --limit 10
```

<details>
<summary>Appendix</summary>

### Emergency Hotfix

```bash
# Create hotfix branch from release tag
git checkout -b hotfix/description vX.Y.Z
# Make fixes, commit, create PR targeting main
# After merge, follow the standard release steps above to publish a new patch version
```

### Troubleshooting

**Tag already exists:**
```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# Then recreate
```

**Delete a release:**
```bash
gh release delete vX.Y.Z --yes
```

### Custom Release Notes

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(cat <<'EOF'
## What's Changed
- Feature: Description (#PR)
- Fix: Description (#PR)
EOF
)"
```

</details>
