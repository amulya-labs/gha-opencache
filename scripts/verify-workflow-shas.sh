#!/bin/bash
set -euo pipefail

# verify-workflow-shas.sh
# Verifies that all action SHAs in GitHub workflow files are valid and match their version comments

WORKFLOW_DIR=".github/workflows"
ERRORS=0
CHECKED=0
TEMP_FILE=$(mktemp)

echo "🔍 Verifying action SHAs in workflow files..."
echo ""

# Extract all uses: statements with SHA references into temp file
grep -rh "uses:.*@[a-f0-9]\{40\}" "$WORKFLOW_DIR" | sort -u > "$TEMP_FILE" || true

# Process each unique action reference
while IFS= read -r line; do
  # Extract the action reference (format: owner/repo/path@sha[# version])
  if [[ $line =~ uses:[[:space:]]+([^@]+)@([a-f0-9]{40})([[:space:]]*#[[:space:]]*(.+))? ]]; then
    ACTION="${BASH_REMATCH[1]}"
    SHA="${BASH_REMATCH[2]}"
    VERSION="${BASH_REMATCH[4]}"

    CHECKED=$((CHECKED + 1))

    # Check if version comment is present
    if [[ -z "$VERSION" ]]; then
      echo "[$CHECKED] Checking: $ACTION@$SHA"
      echo "  ❌ ERROR: Missing version comment (e.g., '# vX.Y.Z') for SHA-pinned action"
      echo "  All SHA-pinned actions must include a version comment for maintainability."
      ERRORS=$((ERRORS + 1))
      continue
    fi

    echo "[$CHECKED] Checking: $ACTION@$SHA ($VERSION)"

    # Extract owner/repo from action (handle both simple and composite paths)
    if [[ $ACTION =~ ^([^/]+/[^/]+) ]]; then
      REPO="${BASH_REMATCH[1]}"

      # Verify SHA exists in the repository
      echo "  → Verifying SHA exists..."
      if ! gh api "repos/$REPO/commits/$SHA" --jq '.sha' &>/dev/null; then
        echo "  ❌ ERROR: SHA not found in $REPO"
        ERRORS=$((ERRORS + 1))
        continue
      fi

      # Verify SHA matches the version tag (if it's a semver tag)
      if [[ $VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "  → Verifying SHA matches tag $VERSION..."

        # Get tag reference
        TAG_REF=$(gh api "repos/$REPO/git/refs/tags/$VERSION" 2>/dev/null || echo "")

        if [[ -z "$TAG_REF" ]]; then
          echo "  ⚠️  WARNING: Could not find tag $VERSION in $REPO"
          echo "  ✅ Valid (SHA exists, tag not verified)"
          continue
        fi

        # Extract tag SHA and type
        TAG_SHA=$(echo "$TAG_REF" | jq -r '.object.sha')
        TAG_TYPE=$(echo "$TAG_REF" | jq -r '.object.type')

        # If it's an annotated tag, dereference it to get the commit SHA
        if [[ "$TAG_TYPE" == "tag" ]]; then
          EXPECTED_SHA=$(gh api "repos/$REPO/git/tags/$TAG_SHA" --jq '.object.sha' 2>/dev/null || echo "")
        else
          EXPECTED_SHA="$TAG_SHA"
        fi

        if [[ -z "$EXPECTED_SHA" ]]; then
          echo "  ⚠️  WARNING: Could not dereference tag $VERSION in $REPO"
          echo "  ✅ Valid (SHA exists, tag not verified)"
          continue
        fi

        if [[ "$SHA" != "$EXPECTED_SHA" ]]; then
          echo "  ❌ ERROR: SHA mismatch for $VERSION"
          echo "     Expected: $EXPECTED_SHA"
          echo "     Got:      $SHA"
          ERRORS=$((ERRORS + 1))
          continue
        fi
      fi

      echo "  ✅ Valid"
    fi
  fi
done < "$TEMP_FILE"

# Cleanup
rm -f "$TEMP_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Checked: $CHECKED unique action references"

if [[ $ERRORS -eq 0 ]]; then
  echo "✅ All SHAs are valid!"
  exit 0
else
  echo "❌ Found $ERRORS error(s)"
  exit 1
fi
