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

## What Happens Automatically

When you create a release, the **release workflow** runs 5 parallel jobs:

1. **build-artifacts** - Compiles and packages the action
2. **provenance** - Generates SLSA Level 3 attestation
3. **upload-assets** - Attaches signed artifacts to release
4. **publish-package** - Publishes to GitHub Packages (npm)
5. **update-major-tag** - Updates floating tag (e.g., `v2` → `v2.2.3`)

**Generated Artifacts:**
- Source tarball (`gha-opencache-vX.Y.Z.tar.gz`)
- Dist bundle (`gha-opencache-vX.Y.Z-dist.tar.gz`)
- SHA256 checksums (`checksums.txt`)
- **SLSA provenance** (`*.intoto.jsonl`) - 10/10 OpenSSF score

Users referencing `@v2` automatically get the latest compatible version. The entire release process completes in ~2-3 minutes.

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
- `PUBLIC_REPO_WRITE_PAT`: Fine-grained PAT with **Repository permissions > Contents: Read and write** (for updating floating major tags)

**Workflow Permissions** (configured automatically):
- `id-token: write` - SLSA provenance generation
- `contents: write` - Upload assets and update tags
- `packages: write` - Publish to GitHub Packages

**Workflow Structure:**
All jobs run in parallel except `upload-assets` and `publish-package` which wait for artifact generation. The workflow is consolidated into `.github/workflows/release.yml` for easier maintenance.

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
