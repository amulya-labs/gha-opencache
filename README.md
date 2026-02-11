# gha-opencache

[![CI](https://github.com/amulya-labs/gha-opencache/actions/workflows/ci.yml/badge.svg)](https://github.com/amulya-labs/gha-opencache/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/amulya-labs/gha-opencache/branch/main/graph/badge.svg)](https://codecov.io/gh/amulya-labs/gha-opencache)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/amulya-labs/gha-opencache/badge)](https://securityscorecards.dev/viewer/?uri=github.com/amulya-labs/gha-opencache)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

100% API-compatible replacement for `actions/cache` with local filesystem, S3-compatible, and Google Cloud Storage support for self-hosted runners.

## Quick Start

```yaml
- uses: amulya-labs/gha-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-
```

<details>
<summary>S3 and GCS Quick Start</summary>

**S3-compatible** (MinIO, R2, AWS S3, etc.):
```yaml
- uses: amulya-labs/gha-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    storage-provider: s3
    s3-bucket: my-cache-bucket
    s3-endpoint: https://minio.example.com  # omit for AWS S3
    s3-force-path-style: true  # required for MinIO
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.S3_ACCESS_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.S3_SECRET_KEY }}
```

**Google Cloud Storage**:
```yaml
- uses: amulya-labs/gha-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    storage-provider: gcs
    gcs-bucket: my-cache-bucket
    gcs-project: my-project
  env:
    GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCP_SA_KEY_PATH }}
```

</details>

> [MIGRATION.md](MIGRATION.md) - Setup instructions for all storage backends
> [examples/](examples/) - Complete workflow examples

## Features

**Storage:** Local filesystem, S3-compatible (AWS, MinIO, R2, Spaces), Google Cloud Storage
**Matching:** restore-keys prefix matching (newest-first), 100% `actions/cache` compatible
**Management:** Configurable compression (zstd/gzip/none), TTL expiration, LRU eviction
**Platform:** Linux, macOS, Windows

## Options

| Input | Description | Default |
|-------|-------------|---------|
| **Core** |||
| `key` | Primary cache key for save/restore | *required* |
| `path` | Files/directories to cache (newline-separated) | *required* |
| `restore-keys` | Fallback keys for partial matches | - |
| **Behavior** |||
| `fail-on-cache-miss` | Fail workflow if no cache found | `false` |
| `lookup-only` | Check existence without downloading | `false` |
| `save-always` | Save cache even if previous steps fail | `false` |
| **Storage** |||
| `storage-provider` | Backend: `local`, `s3`, or `gcs` | `local` |
| `cache-path` | Base path for local cache | `/srv/gha-cache/v1` |
| **S3** *(when storage-provider: s3)* |||
| `s3-bucket` | S3 bucket name | *required* |
| `s3-region` | AWS region | `us-east-1` |
| `s3-endpoint` | Custom endpoint (MinIO, R2, Spaces) | - |
| `s3-prefix` | Key prefix in bucket | `gha-cache/` |
| `s3-force-path-style` | Path-style URLs (required for MinIO) | `false` |
| **GCS** *(when storage-provider: gcs)* |||
| `gcs-bucket` | GCS bucket name | *required* |
| `gcs-project` | GCP project ID | - |
| `gcs-prefix` | Key prefix in bucket | `gha-cache/` |
| `gcs-key-file` | Service account key file path | - |
| **Compression** |||
| `compression` | Algorithm: `auto`, `zstd`, `gzip`, `none` | `auto` |
| `compression-level` | Level (zstd: 1-19, gzip: 1-9) | 3 / 6 |
| **Lifecycle** |||
| `ttl-days` | Days until cache expires (0 = never) | `7` |
| `max-cache-size-gb` | Max size per repo in GB (0 = unlimited) | `10` |

**Environment variables for cloud storage:**
- S3: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- GCS: `GOOGLE_APPLICATION_CREDENTIALS` (or Workload Identity)

## Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | `true` if exact match found for primary key |
| `cache-primary-key` | The primary key that was used |
| `cache-matched-key` | Key of restored cache (empty if no match) |

## restore-keys Behavior

Fallback mechanism when exact `key` match not found.

**Algorithm:** (1) Exact match on `key` → `cache-hit = true` | (2) Each `restore-keys` prefix → newest match → `cache-hit = false` | (3) No match → `cache-hit = false`

**Example:**
```yaml
key: npm-linux-v20-abc123
restore-keys: |
  npm-linux-v20-      # specific version first
  npm-linux-          # broader OS match
  npm-                # broadest fallback
```

**Best practices:** Order specific→general, include `${{ runner.os }}`, use version identifiers

> [examples/restore-keys-advanced.yml](examples/restore-keys-advanced.yml) - Advanced patterns

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

| Method | Speed | Ratio | When to Use |
|--------|-------|-------|-------------|
| `auto` (default) | - | - | Detects zstd → falls back to gzip |
| `zstd` | Fast | Excellent | Best for most cases |
| `gzip` | Moderate | Good | Maximum compatibility |
| `none` | Fastest | N/A | Pre-compressed files |

**Levels:** zstd 1-19 (default: 3), gzip 1-9 (default: 6)

> [examples/compression-tuning.yml](examples/compression-tuning.yml)

## Architecture

Designed for reliability with self-healing cache indexes and lock-free archive creation.

> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Technical deep dive

## vs actions/cache

| Feature | actions/cache | gha-opencache |
|---------|---------------|-------------------|
| GitHub-hosted cache | Yes | No |
| Local / S3 / GCS storage | No | Yes |
| API compatibility | - | 100% |
| Compression options | zstd only | zstd, gzip, none |
| Configurable TTL/limits | No | Yes |

**Use `actions/cache`:** GitHub-hosted runners
**Use `gha-opencache`:** Self-hosted runners with custom storage

## Examples

[`examples/`](examples/) - Complete workflows for:

**Languages:** [Node.js](examples/node-basic.yml), [Python](examples/python-pip.yml), [Go](examples/go-modules.yml), [Rust](examples/rust-cargo.yml)
**Storage:** [MinIO](examples/s3-minio.yml), [Cloudflare R2](examples/s3-cloudflare-r2.yml)
**Advanced:** [Multi-cache](examples/multi-cache.yml), [restore-keys](examples/restore-keys-advanced.yml), [Compression](examples/compression-tuning.yml)

## Troubleshooting

**Enable debug:** `env: ACTIONS_STEP_DEBUG: true`

**Quick fixes:**
- **Not restoring** → Check key format, verify `restore-keys` prefixes
- **Docker containers** → Mount cache as volume: see [docs/DOCKER.md](docs/DOCKER.md)
- **Permission denied** → Create directory: `sudo mkdir -p /srv/gha-cache/v1 && sudo chown -R $(whoami) /srv/gha-cache/v1`
- **S3 auth fails** → Verify secrets, check IAM permissions
- **Cache too large** → Reduce `max-cache-size-gb` or `ttl-days`
- **Slow operations** → `compression-level: 1` or `compression: none`
- **Cross-platform** → Include `${{ runner.os }}` in key

<details>
<summary>Detailed Troubleshooting</summary>

### Cache Not Restoring

Debug cache key:
```yaml
- run: echo "Key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}"
```

Check local storage:
```bash
ls -la /srv/gha-cache/v1/owner/repo/
```

Verify restore-keys have no trailing slashes or extra characters.

### Docker Containers

**Problem**: Cache saved in one job but not found in another.

**Cause**: Docker containers have isolated filesystems. Each container sees its own `/srv/gha-cache/v1` unless mounted from host.

**Quick fix**:
```yaml
container:
  image: my-image
  volumes:
    - /srv/gha-cache:/srv/gha-cache
```

> **See [docs/DOCKER.md](docs/DOCKER.md)** for complete setup guide (container volumes, Kubernetes, Docker Compose, verification, troubleshooting).

### Permission Denied or Directory Missing

First, check if the cache directory exists:
```bash
ls -la /srv/gha-cache/v1
```

**Directory doesn't exist:**
```bash
sudo mkdir -p /srv/gha-cache/v1
sudo chown -R runner-user:runner-group /srv/gha-cache/v1
chmod 755 /srv/gha-cache/v1
```

**Directory exists but wrong permissions:**
```bash
sudo chown -R runner-user:runner-group /srv/gha-cache/v1
chmod 755 /srv/gha-cache/v1
```

Replace `runner-user:runner-group` with your actual runner user.

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
ttl-days: 3             # Shorter than default 7 days
compression-level: 9    # Increase compression
```

Manual cleanup:
```bash
find /srv/gha-cache/v1 -type f -mtime +7 -delete
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

---

**[MIGRATION.md](MIGRATION.md)** - Setup guide for all storage backends
**[examples/](examples/)** - Complete workflow examples
**[Issues](https://github.com/amulya-labs/gha-opencache/issues)** - Bug reports & features

**License:** MIT - see [LICENSE](LICENSE)
