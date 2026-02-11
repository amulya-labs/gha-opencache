# gha-opencache

[![CI](https://github.com/amulya-labs/gha-opencache/actions/workflows/ci.yml/badge.svg)](https://github.com/amulya-labs/gha-opencache/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/amulya-labs/gha-opencache/branch/main/graph/badge.svg)](https://codecov.io/gh/amulya-labs/gha-opencache)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/amulya-labs/gha-opencache/badge)](https://securityscorecards.dev/viewer/?uri=github.com/amulya-labs/gha-opencache)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

100% API-compatible replacement for `actions/cache` with local filesystem, S3-compatible, and Google Cloud Storage support for self-hosted runners.

## Why Use This?

Built for **self-hosted runners** with flexible storage options:
- **Local filesystem** - Cache on runner disk
- **S3-compatible** - AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage** - Native GCS with Workload Identity
- **Full restore-keys** - Proper prefix matching (newest-first)
- **100% compatible** - Drop-in replacement for `actions/cache`

## Quick Start

```yaml
- uses: amulya-labs/gha-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-
    # storage-provider: local  # default (also: s3, gcs)
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

→ [MIGRATION.md](MIGRATION.md) - Setup instructions for all storage backends
→ [examples/](examples/) - Complete workflow examples

## Features

**Storage:** Local filesystem • S3-compatible (AWS, MinIO, R2, Spaces) • Google Cloud Storage
**Matching:** restore-keys prefix matching (newest-first) • 100% `actions/cache` compatible
**Management:** Configurable compression (zstd/gzip/none) • TTL expiration • LRU eviction
**Platform:** Linux • macOS • Windows

## Inputs & Outputs

**Required:** `key` (primary cache key) • `path` (files/directories to cache)

**Optional:** `restore-keys` (fallback keys) • `storage-provider` (`local`|`s3`|`gcs`, default: `local`)

**Storage-specific:** See table below or [MIGRATION.md](MIGRATION.md) for detailed configuration

| Storage | Required Inputs | Optional Inputs | Environment Variables |
|---------|----------------|-----------------|----------------------|
| **local** | - | `cache-path` (default: `/srv/gha-cache/v1`) | - |
| **s3** | `s3-bucket` | `s3-endpoint`, `s3-region`, `s3-prefix`, `s3-force-path-style` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| **gcs** | `gcs-bucket` | `gcs-project`, `gcs-prefix` | `GOOGLE_APPLICATION_CREDENTIALS` (or Workload Identity) |

**Outputs:** `cache-hit` (bool) • `cache-primary-key` (string) • `cache-matched-key` (string)

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

Three storage options, all with identical cache semantics:

1. **Local filesystem** (default) - `/srv/gha-cache/v1/{owner}/{repo}/`
2. **S3-compatible** - AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
3. **Google Cloud Storage** - Native GCS with Workload Identity or service account

→ **[MIGRATION.md](MIGRATION.md)** - Complete setup guide for all providers

<details>
<summary>Quick Reference: S3 Provider Endpoints</summary>

| Provider | endpoint | force-path-style |
|----------|----------|------------------|
| AWS S3 | (omit - uses default) | `false` |
| MinIO | `https://minio.example.com` | `true` |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `false` |
| DigitalOcean Spaces | `https://nyc3.digitaloceanspaces.com` | `false` |

Required permissions: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

</details>

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

**Best practices:** Order specific→general • Include `${{ runner.os }}` • Use version identifiers

→ [examples/restore-keys-advanced.yml](examples/restore-keys-advanced.yml) - Advanced patterns

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
| `zstd` | Fast | Excellent | Best for most cases, supports frames requiring large decompression windows (when built with `--long=30`) |
| `gzip` | Moderate | Good | Maximum compatibility |
| `none` | Fastest | N/A | Pre-compressed files |

**Levels:** zstd 1-19 (default: 3) • gzip 1-9 (default: 6)

**Large cache support:** when built with zstd `--long=30`, decompression can use larger window sizes (up to ~1GB of memory) to handle frames that require large windows

**Tuning:** Fast=`level: 1` • Best ratio=`level: 19` • Skip=`compression: none`

→ [examples/compression-tuning.yml](examples/compression-tuning.yml)

## Cache Management

**TTL expiration:** Auto-delete after `ttl-days` (default: 30, 0=disable)
**LRU eviction:** Remove oldest when exceeds `max-cache-size-gb` (default: 10 GB/repo, 0=disable)
**Repository isolation:** Separate namespace per repo, no key collisions

```yaml
ttl-days: 7              # shorter TTL for frequently-changing deps
max-cache-size-gb: 20    # larger limit for monorepos
```

## vs actions/cache

| Feature | actions/cache | gha-opencache |
|---------|---------------|-------------------|
| GitHub-hosted cache | ✅ | ❌ |
| Local / S3 / GCS storage | ❌ | ✅ |
| API compatibility | - | ✅ 100% |
| Compression options | zstd only | zstd, gzip, none |
| Configurable TTL/limits | ❌ | ✅ |

**Use `actions/cache`:** GitHub-hosted runners
**Use `gha-opencache`:** Self-hosted runners with custom storage

## Examples

[`examples/`](examples/) - Complete workflows for:

**Languages:** [Node.js](examples/node-basic.yml) • [Python](examples/python-pip.yml) • [Go](examples/go-modules.yml) • [Rust](examples/rust-cargo.yml)
**Storage:** [MinIO](examples/s3-minio.yml) • [Cloudflare R2](examples/s3-cloudflare-r2.yml)
**Advanced:** [Multi-cache](examples/multi-cache.yml) • [restore-keys](examples/restore-keys-advanced.yml) • [Compression](examples/compression-tuning.yml)

## Troubleshooting

**Enable debug:** `env: ACTIONS_STEP_DEBUG: true`

**Quick fixes:**
- **Not restoring** → Check key format, verify `restore-keys` prefixes
- **Permission denied** → `chown runner-user:runner-group /srv/gha-cache/v1`
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

---

**[MIGRATION.md](MIGRATION.md)** - Setup guide for all storage backends
**[examples/](examples/)** - Complete workflow examples
**[Issues](https://github.com/amulya-labs/gha-opencache/issues)** - Bug reports & features

**License:** MIT - see [LICENSE](LICENSE)
