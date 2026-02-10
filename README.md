# actions-opencache

[![CI](https://github.com/rrl-personal-projects/actions-opencache/actions/workflows/ci.yml/badge.svg)](https://github.com/rrl-personal-projects/actions-opencache/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Drop-in replacement for `actions/cache` with support for local filesystem and S3-compatible storage backends.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
- [Input Reference](#input-reference)
- [Output Reference](#output-reference)
- [Storage Backends](#storage-backends)
- [restore-keys Behavior](#restore-keys-behavior)
- [Compression](#compression)
- [Cache Management](#cache-management)
- [Comparison with actions/cache](#comparison-with-actionscache)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Migration Guide](#migration-guide)
- [License](#license)

## Overview

`actions-opencache` is a 100% API-compatible replacement for GitHub's official `actions/cache` that adds support for:

- **Local filesystem caching** for self-hosted runners
- **S3-compatible storage** (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, etc.)
- **Full restore-keys support** with prefix matching and newest-first ordering

### Why Use This Action?

- **Self-hosted runners**: Cache artifacts locally on your runner's filesystem instead of using GitHub's hosted cache service
- **S3 storage**: Use your own S3-compatible storage for caching across distributed runners
- **restore-keys**: Unlike some alternatives, this action fully implements `restore-keys` with proper prefix matching
- **Drop-in replacement**: Same inputs and outputs as `actions/cache` - just change the `uses:` line

## Quick Start

### Local Filesystem Storage

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-
      npm-
```

### S3-Compatible Storage (MinIO)

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-

    storage-provider: s3
    s3-bucket: github-actions-cache
    s3-endpoint: https://minio.example.com
    s3-force-path-style: true
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.MINIO_ACCESS_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.MINIO_SECRET_KEY }}
```

## Features

- ✅ **restore-keys prefix matching** - Finds newest cache matching each prefix in order
- ✅ **Local filesystem storage** - Cache on self-hosted runner disk
- ✅ **S3-compatible storage** - Use MinIO, AWS S3, Cloudflare R2, etc.
- ✅ **Configurable compression** - zstd, gzip, or none with tunable levels
- ✅ **TTL-based expiration** - Automatically remove stale caches
- ✅ **LRU eviction** - Limit cache size per repository
- ✅ **Cross-platform** - Linux, macOS, and Windows support
- ✅ **100% API compatible** - Drop-in replacement for actions/cache

## Input Reference

### Standard Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `key` | Primary cache key | Yes | - |
| `path` | Files/directories to cache (supports wildcards) | Yes | - |
| `restore-keys` | Ordered fallback keys for cache restoration | No | - |
| `fail-on-cache-miss` | Fail workflow if no cache found | No | `false` |
| `lookup-only` | Check cache exists without downloading | No | `false` |
| `save-always` | Save cache even if job fails | No | `false` |

### Storage Provider Selection

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `storage-provider` | Storage backend: `local` or `s3` | No | `local` |

### Local Storage Options

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `cache-path` | Base directory for local cache storage | No | `/srv/gha-cache/v1` |

### S3 Storage Options

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `s3-bucket` | S3 bucket name | Yes (for S3) | - |
| `s3-region` | S3 region | No | `us-east-1` |
| `s3-endpoint` | Custom S3 endpoint (MinIO, R2, etc.) | No | - |
| `s3-prefix` | Key prefix within bucket | No | `gha-cache/` |
| `s3-force-path-style` | Use path-style URLs (required for MinIO) | No | `false` |

**Authentication**: S3 credentials are configured via environment variables:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` (optional, for temporary credentials)

### Common Options

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `compression` | Compression: `auto`, `zstd`, `gzip`, `none` | No | `auto` |
| `compression-level` | Compression level (1-19 for zstd, 1-9 for gzip) | No | 3 (zstd), 6 (gzip) |
| `ttl-days` | Days until cache expires (0 = never) | No | `30` |
| `max-cache-size-gb` | Max cache size per repo in GB (0 = unlimited) | No | `10` |

## Output Reference

| Output | Description |
|--------|-------------|
| `cache-hit` | `true` if exact match found for primary `key`, `false` otherwise (including restore-keys matches) |
| `cache-primary-key` | The primary key that was requested |
| `cache-matched-key` | The actual key that was restored (may differ if restore-keys was used) |

### Example: Using Outputs

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  id: cache
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}
    restore-keys: npm-

- name: Install dependencies
  if: steps.cache.outputs.cache-hit != 'true'
  run: npm ci

- name: Show cache info
  run: |
    echo "Cache hit: ${{ steps.cache.outputs.cache-hit }}"
    echo "Primary key: ${{ steps.cache.outputs.cache-primary-key }}"
    echo "Matched key: ${{ steps.cache.outputs.cache-matched-key }}"
```

## Storage Backends

### Local Filesystem

The local storage backend caches artifacts on the runner's filesystem.

#### Directory Structure

```
/srv/gha-cache/v1/
└── github.com/
    └── owner/
        └── repo/
            ├── index.json       # Cache metadata
            └── archives/        # Compressed cache files
                ├── npm-linux-abc123.tar.zst
                └── npm-linux-def456.tar.zst
```

#### Setup for Self-Hosted Runners

1. **Create cache directory** (as user that runs the runner):
   ```bash
   sudo mkdir -p /srv/gha-cache/v1
   sudo chown runner-user:runner-group /srv/gha-cache/v1
   chmod 755 /srv/gha-cache/v1
   ```

2. **Permissions**: The runner user must have read/write access to the cache directory.

3. **Storage**: Provision adequate disk space. With default settings (10 GB per repo, 30-day TTL), estimate:
   ```
   Total storage = (number of repos) × (max-cache-size-gb)
   ```

4. **Monitoring**: Set up disk usage alerts to prevent the cache from filling the disk.

#### Custom Cache Path

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}
    cache-path: /mnt/ssd-cache/gha  # Custom location
```

### S3-Compatible Storage

The S3 storage backend works with any S3-compatible service.

#### AWS S3

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}

    storage-provider: s3
    s3-bucket: my-gha-cache-bucket
    s3-region: us-west-2
  env:
    # Use IAM role (recommended) or access keys
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

**IAM Policy Example**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-gha-cache-bucket",
        "arn:aws:s3:::my-gha-cache-bucket/*"
      ]
    }
  ]
}
```

#### MinIO

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}

    storage-provider: s3
    s3-bucket: github-actions-cache
    s3-endpoint: https://minio.example.com
    s3-region: us-east-1
    s3-force-path-style: true  # Required for MinIO
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.MINIO_ACCESS_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.MINIO_SECRET_KEY }}
```

#### Cloudflare R2

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}

    storage-provider: s3
    s3-bucket: my-gha-cache-bucket
    s3-endpoint: https://<account-id>.r2.cloudflarestorage.com
    s3-region: auto
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

#### DigitalOcean Spaces

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}

    storage-provider: s3
    s3-bucket: my-gha-cache
    s3-endpoint: https://nyc3.digitaloceanspaces.com
    s3-region: us-east-1
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.DO_SPACES_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.DO_SPACES_SECRET }}
```

## restore-keys Behavior

The `restore-keys` input provides fallback cache keys when an exact match for the primary `key` is not found.

### How It Works

1. **Try primary key first**: Check for exact match on `key`
   - If found: Restore cache, set `cache-hit = true`

2. **Try restore-keys in order**: For each restore-key (top to bottom):
   - Find all caches with keys matching the prefix
   - Select the **newest** matching cache (by creation time)
   - Restore it, set `cache-hit = false`, set `cache-matched-key` to the actual key

3. **No match**: If no cache found, `cache-hit = false`, `cache-matched-key` is empty

### Examples

#### Example 1: Exact Match

```yaml
key: npm-linux-abc123
restore-keys: |
  npm-linux-
  npm-

# Cached keys: npm-linux-abc123, npm-linux-def456
# Result: Restores npm-linux-abc123 (exact match)
# cache-hit: true
```

#### Example 2: Prefix Match

```yaml
key: npm-linux-xyz999
restore-keys: |
  npm-linux-
  npm-

# Cached keys: npm-linux-abc123, npm-linux-def456
# Result: Restores npm-linux-def456 (newest with prefix npm-linux-)
# cache-hit: false
```

#### Example 3: Multi-Level Fallback

```yaml
key: npm-linux-v20-abc123
restore-keys: |
  npm-linux-v20-
  npm-linux-
  npm-

# Cached keys: npm-darwin-xyz, npm-linux-v18-old, npm-linux-v20-old
# Result: Restores npm-linux-v20-old (newest matching first restore-key)
# cache-hit: false
```

#### Example 4: No Match

```yaml
key: python-linux-abc123
restore-keys: |
  python-linux-
  python-

# Cached keys: npm-linux-abc123, go-linux-def456
# Result: No cache restored
# cache-hit: false
# cache-matched-key: ""
```

### Best Practices

1. **Order matters**: Put more specific prefixes first
2. **Include OS**: `npm-${{ runner.os }}-` prevents mismatches across platforms
3. **Include version**: `npm-linux-v20-` allows fallback to different Node versions
4. **Broad fallback**: End with a generic prefix like `npm-` for maximum reuse

## Compression

### Available Methods

| Method | Speed | Ratio | Notes |
|--------|-------|-------|-------|
| `auto` | - | - | Detects `zstd`, falls back to `gzip` (default) |
| `zstd` | Fast | Excellent | Best choice for most use cases |
| `gzip` | Moderate | Good | Maximum compatibility |
| `none` | Fastest | N/A | For pre-compressed or small files |

### Auto-Detection

The `auto` compression mode (default) works as follows:

1. Check if `zstd` command is available on the runner
2. If yes: use `zstd` with level 3
3. If no: fall back to `gzip` with level 6

### Compression Levels

**zstd** (1-19):
- `1-3`: Fast compression, good for large caches
- `3-9`: Balanced (default: 3)
- `10-19`: Maximum compression, slower

**gzip** (1-9):
- `1-3`: Fast compression
- `4-6`: Balanced (default: 6)
- `7-9`: Maximum compression, slower

### Examples

#### Fast Compression (Large Caches)

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}
    compression: zstd
    compression-level: 1  # Fastest
```

#### Maximum Compression (Slow Network)

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: dist
    key: build-${{ github.sha }}
    compression: zstd
    compression-level: 19  # Best ratio
```

#### No Compression (Pre-compressed Files)

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: |
      dist/**/*.gz
      dist/**/*.br
    key: assets-${{ github.sha }}
    compression: none  # Already compressed
```

## Cache Management

### TTL-Based Expiration

Caches are automatically deleted after the specified TTL (time-to-live).

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}
    ttl-days: 7  # Delete after 7 days
```

- **Default**: 30 days
- **Disable**: Set to `0` for no expiration
- **Use cases**:
  - Short TTL (7 days) for frequently changing dependencies
  - Long TTL (90 days) for stable dependencies
  - No expiration for immutable build artifacts

### LRU Eviction

When cache size exceeds `max-cache-size-gb`, the least-recently-used caches are evicted.

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ hashFiles('package-lock.json') }}
    max-cache-size-gb: 20  # Limit to 20 GB per repository
```

- **Default**: 10 GB per repository
- **Disable**: Set to `0` for unlimited size
- **Scope**: Enforced per repository (not global)

### Repository Isolation

Each repository gets its own isolated cache namespace:

```
/srv/gha-cache/v1/github.com/owner/repo-a/  # Independent
/srv/gha-cache/v1/github.com/owner/repo-b/  # Independent
```

This ensures:
- No key collisions between repositories
- Independent size limits
- Easier cleanup and management

## Comparison with actions/cache

| Feature | actions/cache | actions-opencache |
|---------|---------------|-------------------|
| **Hosted cache** | ✅ GitHub-hosted | ❌ Not supported |
| **Local filesystem** | ❌ Not supported | ✅ Yes |
| **S3-compatible storage** | ❌ Not supported | ✅ Yes (MinIO, R2, etc.) |
| **restore-keys** | ✅ Yes | ✅ Yes (full support) |
| **Input compatibility** | ✅ - | ✅ 100% compatible |
| **Output compatibility** | ✅ - | ✅ 100% compatible |
| **Cross-platform** | ✅ Linux, macOS, Windows | ✅ Linux, macOS, Windows |
| **Compression** | ✅ zstd | ✅ zstd, gzip, none |
| **TTL expiration** | ✅ 7 days (fixed) | ✅ Configurable |
| **Size limits** | ✅ 10 GB (fixed) | ✅ Configurable |

### When to Use actions/cache

- Using GitHub-hosted runners
- No need for custom storage
- Want GitHub's built-in cache analytics

### When to Use actions-opencache

- Using self-hosted runners
- Need local filesystem caching
- Want to use your own S3-compatible storage
- Need configurable TTL and size limits
- Want full control over cache storage

## Examples

See the [`examples/`](examples/) directory for complete workflow examples:

- [`node-basic.yml`](examples/node-basic.yml) - Basic Node.js caching
- [`python-pip.yml`](examples/python-pip.yml) - Python pip cache
- [`go-modules.yml`](examples/go-modules.yml) - Go modules cache
- [`rust-cargo.yml`](examples/rust-cargo.yml) - Rust Cargo cache
- [`s3-minio.yml`](examples/s3-minio.yml) - S3 with MinIO backend
- [`s3-cloudflare-r2.yml`](examples/s3-cloudflare-r2.yml) - Cloudflare R2 backend
- [`multi-cache.yml`](examples/multi-cache.yml) - Multiple caches in one workflow
- [`restore-keys-advanced.yml`](examples/restore-keys-advanced.yml) - Advanced restore-keys patterns
- [`compression-tuning.yml`](examples/compression-tuning.yml) - Compression tuning examples

## Troubleshooting

### Cache Not Restoring

**Problem**: Cache is not being restored even though it should exist.

**Solutions**:
1. Check cache key matches exactly:
   ```yaml
   - name: Debug cache key
     run: echo "Key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}"
   ```

2. Verify restore-keys prefixes are correct (no trailing slashes or extra characters)

3. For local storage, check directory permissions:
   ```bash
   ls -la /srv/gha-cache/v1
   ```

4. Enable debug logging:
   ```yaml
   env:
     ACTIONS_STEP_DEBUG: true
   ```

### Permission Denied (Local Storage)

**Problem**: `EACCES: permission denied` when saving or restoring cache.

**Solutions**:
1. Ensure runner user owns the cache directory:
   ```bash
   sudo chown -R runner-user:runner-group /srv/gha-cache/v1
   ```

2. Check directory permissions (755 minimum):
   ```bash
   chmod 755 /srv/gha-cache/v1
   ```

### S3 Authentication Failures

**Problem**: `Access Denied` or `403 Forbidden` errors with S3.

**Solutions**:
1. Verify credentials are set correctly:
   ```yaml
   env:
     AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
     AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
   ```

2. Check IAM policy allows required actions (PutObject, GetObject, DeleteObject, ListBucket)

3. For MinIO, ensure `s3-force-path-style: true` is set

4. Verify bucket exists and region is correct

### Cache Size Growing Too Large

**Problem**: Cache directory consuming too much disk space.

**Solutions**:
1. Reduce `max-cache-size-gb`:
   ```yaml
   max-cache-size-gb: 5  # Reduce from default 10 GB
   ```

2. Reduce `ttl-days`:
   ```yaml
   ttl-days: 7  # Delete after 1 week instead of 30 days
   ```

3. Use more aggressive compression:
   ```yaml
   compression: zstd
   compression-level: 9
   ```

4. Manually clean up old caches:
   ```bash
   # Find caches older than 30 days
   find /srv/gha-cache/v1 -type f -mtime +30 -delete
   ```

### Slow Cache Save/Restore

**Problem**: Cache operations taking too long.

**Solutions**:
1. Use faster compression:
   ```yaml
   compression: zstd
   compression-level: 1  # Fastest
   ```

2. Disable compression for pre-compressed data:
   ```yaml
   compression: none
   ```

3. Split large caches into multiple smaller caches

4. For S3, ensure runner has good network connection to S3 endpoint

### Cross-Platform Cache Mismatches

**Problem**: Cache from one OS doesn't work on another.

**Solutions**:
1. Include OS in cache key:
   ```yaml
   key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
   ```

2. Use separate caches per platform:
   ```yaml
   restore-keys: |
     npm-${{ runner.os }}-
   ```

3. Avoid caching platform-specific binaries (use `.gitignore` patterns in `path`)

## Migration Guide

See [MIGRATION.md](MIGRATION.md) for detailed migration instructions from `actions/cache`.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please open an issue or pull request.

## Support

- [GitHub Issues](https://github.com/rrl-personal-projects/actions-opencache/issues)
- [Discussions](https://github.com/rrl-personal-projects/actions-opencache/discussions)
