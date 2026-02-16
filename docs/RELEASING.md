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
NEW_VERSION="3.0.0"
```

#### Create Release
```bash
# Ensure main is up to date
git checkout main && git pull origin main

# Verify CI is green
gh run list --branch main --limit 3

# Create and push version tag (this triggers the release workflow)
git tag v${NEW_VERSION}
git push origin v${NEW_VERSION}

# The workflow automatically:
# 1. Creates a draft release
# 2. Builds and uploads artifacts with SLSA provenance
# 3. Publishes the release

# Monitor the workflow
gh run list --limit 1

# Verify once complete
gh release view v${NEW_VERSION}
```

## What Happens Automatically

When you push a version tag, the **release workflow** automatically:

1. **build-artifacts** - Compiles and packages the action
2. **provenance** - Generates SLSA Level 3 attestation
3. **upload-assets** - Creates a draft release, uploads artifacts, then publishes
4. **update-major-tag** - Updates floating tag (e.g., `v3` → `v3.0.1`)

Once the release is published, a separate **publish workflow** (`publish.yml`) automatically:
- **publish-npm** - Publishes to GitHub Packages (npm, stable releases only)

**Generated Artifacts:**
- Source tarball (`gha-opencache-vX.Y.Z.tar.gz`)
- Dist bundle (`gha-opencache-vX.Y.Z-dist.tar.gz`)
- SHA256 checksums (`checksums.txt`)
- **SLSA provenance** (`*.intoto.jsonl`) - 10/10 OpenSSF score

Users referencing `@v3` automatically get the latest compatible version. The entire release process completes in ~2-3 minutes.

> **⚠️ Critical: Never Create Releases for Floating Tags**
>
> GitHub Releases lock their associated tags (`immutable: true`). If a release is created for a floating tag like `v3`, that tag becomes **permanently locked** and cannot be updated or deleted.
>
> The workflow has guards (`if: contains(github.ref_name, '.')`) to prevent this, but manual release creation can still cause corruption:
> - **Wrong:** `gh release create v3 ...`
> - **Right:** `gh release create v3.0.0 ...`
>
> If a floating tag gets corrupted, the only recovery is to increment the major version (e.g., v2 → v3).

## Versioning

- **MAJOR** (`vX.0.0`): Breaking changes
- **MINOR** (`vX.1.0`): New features, backward compatible
- **PATCH** (`vX.0.1`): Bug fixes

Users reference `@v3` (floating tag) to get compatible updates automatically.

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
Two workflows handle releases:
1. `release.yml` triggers on tag push (`v*`). Jobs run in parallel where possible, with `upload-assets` waiting for artifact generation and provenance. The `upload-assets` job creates a draft release, uploads all assets including SLSA provenance, then publishes the release. This pattern avoids "immutable release" errors that occur when trying to upload to already-published releases.
2. `publish.yml` triggers on `release:published` events. This separation improves OpenSSF Scorecard detection and ensures npm publishing only occurs after the release is fully published.

**GitHub Packages Publishing:**
The `publish.yml` workflow modifies `package.json` at publish-time to configure the scoped package name and registry. This is intentional to keep the source `package.json` clean and avoid registry-specific configuration in the repository. The published package metadata will differ from the source repository.

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
# First, identify the provenance file name
PROVENANCE_FILE=$(ls *.intoto.jsonl)

# Then verify the artifact
slsa-verifier verify-artifact \
  gha-opencache-vX.Y.Z.tar.gz \
  --provenance-path "$PROVENANCE_FILE" \
  --source-uri github.com/amulya-labs/gha-opencache
```

Expected: `✓ Verified SLSA provenance`

**What's verified:**
- ✅ Built by GitHub Actions (not locally modified)
- ✅ Source matches tagged commit
- ✅ Build process matches documented workflow
- ✅ Artifact integrity preserved

</details>
