# Releasing

Requires: [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with push access.

## First-Time Marketplace Setup

Before your first release, publish to the GitHub Marketplace manually (one-time):

1. Go to **Releases → Create a new release** in the GitHub UI
2. Check **"Publish this Action to the GitHub Marketplace"**
3. Accept the GitHub Marketplace Developer Agreement
4. Complete the release

After this initial setup, all subsequent releases via `gh release create` will automatically update the marketplace listing.

## Quick Reference

#### Define Version
```bash
# === RELEASE SCRIPT ===
# Update this variable for your release
NEW_VERSION="2.0.0"
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

# Verify
gh release view v${NEW_VERSION}
```

The floating major tag (e.g., `v2`) is updated automatically by GitHub Actions.

## Versioning

- **MAJOR** (`v2.0.0`): Breaking changes
- **MINOR** (`v2.1.0`): New features, backward compatible
- **PATCH** (`v2.0.1`): Bug fixes

Users reference `@v2` (floating tag) to get compatible updates automatically.

## Choosing a Version

```bash
# Check existing tags
git tag --list 'v*' | sort -V

# View changes since last release
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges

# Or view merged PRs
gh pr list --state merged --base main --limit 10
```

<details>
<summary>Appendix</summary>

### Setup Requirements

The release workflow requires a `PUBLIC_REPO_WRITE_PAT` secret configured as a fine-grained PAT restricted to this repository with **Repository permissions > Contents: Read and write** to update floating major tags.

### Important: Never Create Releases for Major Tags

GitHub Releases protect their associated tags from being updated. Only create releases for semver tags (`v2.0.0`), never for floating major tags (`v2`).

**Wrong:** `gh release create v2 ...`
**Right:** `gh release create v2.0.0 ...`

### Emergency Hotfix

```bash
# Create hotfix branch from release tag
git checkout -b hotfix/description vX.Y.Z
# Make fixes, commit, create PR targeting main
# After merge, follow the standard release steps above
```

### Troubleshooting

**Tag already exists:**
```bash
git tag -f vX.Y.Z
git push --force origin vX.Y.Z
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
