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

**Release Assets:** The release workflow automatically generates and attaches:
- Source tarball with checksums
- Dist bundle (compiled action code)
- **SLSA provenance** (*.intoto.jsonl) - cryptographic attestation for supply chain security

These signed artifacts provide a **10/10 OpenSSF Scorecard "Signed-Releases" score**.

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

**Required Secrets:**
- `PUBLIC_REPO_WRITE_PAT`: Fine-grained PAT with **Repository permissions > Contents: Read and write** to update floating major tags

**Workflow Permissions:**
- The release workflow requires `id-token: write` permission for SLSA provenance generation (already configured)
- GitHub automatically provides this for releases

**What Happens Automatically:**
When you create a release (via `gh release create`), the release workflow:
1. Builds the action and packages dist files
2. Creates source tarball and dist bundle
3. Generates SHA256 checksums
4. Creates **SLSA Level 3 provenance** (*.intoto.jsonl)
5. Uploads all artifacts to the release

This ensures every release has cryptographically signed artifacts for supply chain security.

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

### Verifying Release Signatures

All releases include SLSA Level 3 provenance for supply chain security.

**Download provenance:**
```bash
gh release download vX.Y.Z --pattern "*.intoto.jsonl"
```

**Verify artifact** (requires [slsa-verifier](https://github.com/slsa-framework/slsa-verifier)):
```bash
slsa-verifier verify-artifact \
  gha-opencache-vX.Y.Z.tar.gz \
  --provenance-path *.intoto.jsonl \
  --source-uri github.com/amulya-labs/gha-opencache
```

Expected: `✓ Verified SLSA provenance`

**What's verified:**
- ✅ Built by GitHub Actions (not locally modified)
- ✅ Source matches tagged commit
- ✅ Build process matches documented workflow
- ✅ Artifact integrity preserved

</details>
