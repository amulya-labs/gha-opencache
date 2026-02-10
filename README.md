# actions-opencache

[![CI](https://github.com/rrl-personal-projects/actions-opencache/actions/workflows/ci.yml/badge.svg)](https://github.com/rrl-personal-projects/actions-opencache/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/rrl-personal-projects/actions-opencache/branch/main/graph/badge.svg)](https://codecov.io/gh/rrl-personal-projects/actions-opencache)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/rrl-personal-projects/actions-opencache/badge)](https://securityscorecards.dev/viewer/?uri=github.com/rrl-personal-projects/actions-opencache)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

100% API-compatible replacement for `actions/cache` with local filesystem, S3-compatible, and Google Cloud Storage support for self-hosted runners.

## Why Use This?

- **Self-hosted runners** - Cache locally instead of GitHub's hosted service
- **Custom S3 storage** - Use your own S3, MinIO, R2, or compatible storage
- **Google Cloud Storage** - Native GCS support with Workload Identity
- **Full restore-keys support** - Proper prefix matching with newest-first ordering
- **Drop-in compatible** - Same API as `actions/cache`

## Quick Start

**Local filesystem** (default):
```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-
```

**S3-compatible storage**:
```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    storage-provider: s3
    s3-bucket: my-cache-bucket
    s3-endpoint: https://minio.example.com  # or AWS S3, R2, etc.
    s3-force-path-style: true  # for MinIO
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.S3_ACCESS_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.S3_SECRET_KEY }}
```

**Google Cloud Storage**:
```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    storage-provider: gcs
    gcs-bucket: my-cache-bucket
    gcs-project: my-project
  env:
    GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCP_SA_KEY_PATH }}
```

→ See [MIGRATION.md](MIGRATION.md) for setup instructions
→ See [examples/](examples/) for more use cases

## Features

- ✅ Local filesystem storage for self-hosted runners
- ✅ S3-compatible storage (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, etc.)
- ✅ Google Cloud Storage (GCS) with native Workload Identity support
- ✅ Full restore-keys prefix matching with newest-first ordering
- ✅ Configurable compression (zstd, gzip, none) and levels
- ✅ TTL-based expiration and LRU eviction
- ✅ Cross-platform (Linux, macOS, Windows)
- ✅ 100% API compatible with `actions/cache`

## Inputs & Outputs

### Core Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `key` | Primary cache key | **Yes** | - |
| `path` | Files/directories to cache (supports wildcards) | **Yes** | - |
| `restore-keys` | Ordered fallback keys (newline-separated) | No | - |
| `storage-provider` | Storage backend: `local`, `s3`, or `gcs` | No | `local` |

### Storage Configuration

**Local filesystem:**
- `cache-path` - Base directory (default: `/srv/gha-cache/v1`)

**S3-compatible:**
- `s3-bucket` - Bucket name (required for S3)
- `s3-endpoint` - Custom endpoint (for MinIO, R2, etc.)
- `s3-region` - Region (default: `us-east-1`)
- `s3-prefix` - Key prefix (default: `gha-cache/`)
- `s3-force-path-style` - Use path-style URLs (required for MinIO)
- Environment: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`

**Google Cloud Storage:**
- `gcs-bucket` - Bucket name (required for GCS)
- `gcs-project` - Project ID (optional, uses default from credentials)
- `gcs-prefix` - Key prefix (default: `gha-cache/`)
- `gcs-key-file` - Path to service account key JSON
- Environment: `GOOGLE_APPLICATION_CREDENTIALS` (or use Workload Identity)

### Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | `true` if exact match for `key`, `false` if restored via `restore-keys` or not found |
| `cache-primary-key` | The requested primary key |
| `cache-matched-key` | Actual restored key (differs from primary if `restore-keys` was used) |

<details>
<summary>Additional Inputs</summary>

| Input | Description | Default |
|-------|-------------|---------|
| `fail-on-cache-miss` | Fail workflow if no cache found | `false` |
| `lookup-only` | Check cache exists without downloading | `false` |
| `save-always` | Save cache even if job fails | `false` |
| `compression` | Compression method: `auto`, `zstd`, `gzip`, `none` | `auto` |
| `compression-level` | Compression level (1-19 for zstd, 1-9 for gzip) | 3 (zstd), 6 (gzip) |
| `ttl-days` | Days until cache expires (0 = never) | `30` |
| `max-cache-size-gb` | Max cache size per repo in GB (0 = unlimited) | `10` |

</details>

## Storage Backends

**Local filesystem** (default) - Caches on runner disk at `/srv/gha-cache/v1/`

**S3-compatible** - Works with AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, etc.

**Google Cloud Storage (GCS)** - Native GCS with Workload Identity or service account keys

→ See [MIGRATION.md](MIGRATION.md) for setup instructions for each provider

<details>
<summary>Local Filesystem Details</summary>

**Directory structure:**
```
/srv/gha-cache/v1/github.com/owner/repo/
├── index.json       # Cache metadata
└── archives/        # Compressed cache files
```

**Setup:**
```bash
sudo mkdir -p /srv/gha-cache/v1
sudo chown runner-user:runner-group /srv/gha-cache/v1
chmod 755 /srv/gha-cache/v1
```

**Storage estimate:**
```
Total = (number of repos) × (max-cache-size-gb per repo)
```

**Custom path:**
```yaml
cache-path: /mnt/ssd-cache/gha
```

</details>

<details>
<summary>S3 Provider Configuration</summary>

All S3-compatible providers use the same basic configuration with provider-specific endpoints:

| Provider | endpoint | region | force-path-style |
|----------|----------|--------|------------------|
| AWS S3 | (omit) | `us-west-2` | `false` |
| MinIO | `https://minio.example.com` | `us-east-1` | `true` |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto` | `false` |
| DigitalOcean Spaces | `https://nyc3.digitaloceanspaces.com` | `us-east-1` | `false` |

**Required IAM permissions:**
- `s3:PutObject`
- `s3:GetObject`
- `s3:DeleteObject`
- `s3:ListBucket`

</details>

## restore-keys Behavior

Provides fallback cache keys when exact `key` match is not found.

**Algorithm:**
1. Try exact match on `key` → If found: `cache-hit = true`
2. Try each `restore-keys` prefix in order → Find newest matching cache → `cache-hit = false`
3. No match → `cache-hit = false`, `cache-matched-key` is empty

**Example:**
```yaml
key: npm-linux-v20-abc123
restore-keys: |
  npm-linux-v20-      # Try newest v20 cache first
  npm-linux-          # Fall back to any Linux cache
  npm-                # Fall back to any OS
```

**Best practices:**
- Order from specific to general
- Include `${{ runner.os }}` to prevent cross-platform mismatches
- Include version identifiers for graceful degradation

→ See [examples/restore-keys-advanced.yml](examples/restore-keys-advanced.yml) for more patterns

<details>
<summary>Detailed Examples</summary>

**Exact match:**
```yaml
key: npm-linux-abc123
restore-keys: npm-linux-
# Cached: npm-linux-abc123, npm-linux-def456
# Restores: npm-linux-abc123 (exact)
# cache-hit: true
```

**Prefix match:**
```yaml
key: npm-linux-xyz999  # doesn't exist
restore-keys: npm-linux-
# Cached: npm-linux-abc123 (older), npm-linux-def456 (newer)
# Restores: npm-linux-def456 (newest with prefix)
# cache-hit: false
```

**Multi-level fallback:**
```yaml
key: npm-linux-v20-new
restore-keys: |
  npm-linux-v20-
  npm-linux-
# Cached: npm-linux-v18-old, npm-linux-v20-old
# Restores: npm-linux-v20-old (matches first restore-key)
# cache-hit: false
```

**No match:**
```yaml
key: python-abc123
restore-keys: python-
# Cached: npm-linux-abc123, go-linux-def456
# Restores: (nothing)
# cache-hit: false, cache-matched-key: ""
```

</details>

## Compression

| Method | Speed | Ratio | Use Case |
|--------|-------|-------|----------|
| `auto` | - | - | Default - detects zstd, falls back to gzip |
| `zstd` | Fast | Excellent | Best for most use cases |
| `gzip` | Moderate | Good | Maximum compatibility |
| `none` | Fastest | N/A | Pre-compressed files |

**Compression levels:**
- zstd: 1-19 (default: 3)
- gzip: 1-9 (default: 6)

**Examples:**
```yaml
compression: zstd
compression-level: 1    # Fast for large caches

compression: zstd
compression-level: 19   # Best ratio for slow networks

compression: none       # Skip for pre-compressed data
```

→ See [examples/compression-tuning.yml](examples/compression-tuning.yml) for detailed examples

## Cache Management

**TTL expiration** - Caches auto-delete after `ttl-days` (default: 30, set 0 to disable)

**LRU eviction** - When size exceeds `max-cache-size-gb`, least-recently-used caches are removed (default: 10 GB per repo, set 0 to disable)

**Repository isolation** - Each repo has isolated cache namespace, preventing key collisions

```yaml
ttl-days: 7              # Delete after 7 days
max-cache-size-gb: 20    # Limit to 20 GB per repo
```

## vs actions/cache

| Feature | actions/cache | actions-opencache |
|---------|---------------|-------------------|
| GitHub-hosted cache | ✅ | ❌ |
| Local filesystem | ❌ | ✅ |
| S3-compatible storage | ❌ | ✅ |
| API compatibility | - | ✅ 100% |
| restore-keys | ✅ | ✅ |
| Compression | zstd only | zstd, gzip, none |
| TTL / Size limits | Fixed | Configurable |

**Use actions/cache if:** GitHub-hosted runners, no custom storage needed

**Use actions-opencache if:** Self-hosted runners, local filesystem or S3 storage, need configurable limits

## Examples

Complete workflow examples in [`examples/`](examples/):

**Language-specific:**
[Node.js](examples/node-basic.yml) • [Python](examples/python-pip.yml) • [Go](examples/go-modules.yml) • [Rust](examples/rust-cargo.yml)

**Storage backends:**
[MinIO](examples/s3-minio.yml) • [Cloudflare R2](examples/s3-cloudflare-r2.yml)

**Advanced usage:**
[Multiple caches](examples/multi-cache.yml) • [restore-keys patterns](examples/restore-keys-advanced.yml) • [Compression tuning](examples/compression-tuning.yml)

## Troubleshooting

**Enable debug logging:**
```yaml
env:
  ACTIONS_STEP_DEBUG: true
```

**Common issues:**
- Cache not restoring → Check key formatting, verify `restore-keys` prefixes
- Permission denied → Ensure runner user owns cache directory (`chown runner-user /srv/gha-cache/v1`)
- S3 auth failures → Verify credentials in secrets, check IAM permissions
- Cache too large → Reduce `max-cache-size-gb` or `ttl-days`
- Slow operations → Use faster compression (`compression-level: 1`) or `compression: none`
- Cross-platform issues → Include `${{ runner.os }}` in cache key

<details>
<summary>Detailed Troubleshooting</summary>

### Cache Not Restoring

Debug cache key:
```yaml
- run: echo "Key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}"
```

Check local storage:
```bash
ls -la /srv/gha-cache/v1/github.com/owner/repo/
```

Verify restore-keys have no trailing slashes or extra characters.

### Permission Denied

```bash
sudo chown -R runner-user:runner-group /srv/gha-cache/v1
chmod 755 /srv/gha-cache/v1
```

### S3 Authentication

Verify secrets are set:
```yaml
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

Check IAM policy includes: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

For MinIO: `s3-force-path-style: true` required

### Cache Size Too Large

```yaml
max-cache-size-gb: 5   # Reduce from default 10 GB
ttl-days: 7             # Reduce from default 30 days
compression-level: 9    # Increase compression
```

Manual cleanup:
```bash
find /srv/gha-cache/v1 -type f -mtime +30 -delete
```

### Slow Cache Operations

```yaml
compression: zstd
compression-level: 1    # Fastest compression

# or
compression: none       # Skip compression
```

Split large caches into multiple smaller ones.

For S3: ensure good network connectivity to endpoint.

### Cross-Platform Mismatches

Always include OS in key:
```yaml
key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
restore-keys: npm-${{ runner.os }}-
```

Avoid caching platform-specific binaries.

</details>

## Documentation

- [MIGRATION.md](MIGRATION.md) - Migration from `actions/cache` and infrastructure setup
- [examples/](examples/) - Complete workflow examples
- [Issues](https://github.com/rrl-personal-projects/actions-opencache/issues) - Bug reports and feature requests

## License

MIT - see [LICENSE](LICENSE)
