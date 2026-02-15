<h1 align="center">OpenCache Actions</h1>

<p align="center">
  <strong><a href="https://github.com/amulya-labs/gha-opencache">📦 Open-source GitHub Repository</a></strong> • <strong><a href="CONTRIBUTING.md">🤝 Contributing Guide</a></strong>
</p>

<p align="center">
  <em>Speed up your CI/CD pipelines by 2-10x with local caching—without relying on GitHub's servers.</em>
</p>

<p align="center">
OpenCache Actions stores your build caches wherever you want: <strong>local file storage</strong>, your own servers, S3, or Google Cloud Storage. Self-hosted runners with local storage can see <strong>5-10x faster cache operations</strong> (seconds instead of minutes), while cloud storage setups typically gain <strong>2-3x speed improvements</strong>. Drop it into your existing workflows with zero configuration changes—full control, zero vendor lock-in.
</p>

---

[![CI](https://github.com/amulya-labs/gha-opencache/actions/workflows/ci.yml/badge.svg)](https://github.com/amulya-labs/gha-opencache/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/amulya-labs/gha-opencache/branch/main/graph/badge.svg)](https://codecov.io/gh/amulya-labs/gha-opencache)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/amulya-labs/gha-opencache/badge)](https://securityscorecards.dev/viewer/?uri=github.com/amulya-labs/gha-opencache)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/11945/badge)](https://www.bestpractices.dev/projects/11945)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Fast, configurable drop-in replacement for [`actions/cache`](https://github.com/actions/cache) with pluggable backends (local disk, S3-compatible, Google Cloud Storage).

> **OpenCache Actions** gives you full control over where and how your GitHub Actions caches are stored — without changing your workflow.
>
> 💡 **We welcome open-source contributions!** Whether you're fixing bugs, adding features, or improving documentation, we'd love your help.

---

## Quick Start

```yaml
- uses: amulya-labs/gha-opencache@v2
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-
```

<details>
<summary>S3 and GCS Quick Start</summary>

**S3-compatible** (MinIO, R2, AWS S3, etc.):

```yaml
- uses: amulya-labs/gha-opencache@v2
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    storage-provider: s3
    s3-bucket: my-cache-bucket
    s3-endpoint: https://minio.example.com # omit for AWS S3
    s3-force-path-style: true # required for MinIO
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.S3_ACCESS_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.S3_SECRET_KEY }}
```

**Google Cloud Storage**:

```yaml
- uses: amulya-labs/gha-opencache@v2
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

## Why **OpenCache Actions**?

- 🔌 **Drop-in replacement** — API compatible with `actions/cache`
- ⚡ **Fast by design** — Local disk backend avoids network round-trips
- 🔄 **Pluggable storage backends** — Local disk, S3-compatible (AWS S3, MinIO, R2, Spaces), and native Google Cloud Storage
- 🎛️ **Advanced cache controls** — Configurable TTL, size limits, and LRU eviction
- 🗜️ **Flexible compression** — `zstd`, `gzip`, or none
- 🛡️ **Self-healing** — Automatic recovery from index corruption
- 🔄 **Restore-key support** — Prefix matching with newest-first selection
- 💻 **Cross-platform** — Linux, macOS, Windows

## vs [`actions/cache`](https://github.com/actions/cache)

| Feature                      | `actions/cache` | OpenCache Actions |
| ---------------------------- | :-------------: | :---------------: |
| API compatible               |       ✅        |        ✅         |
| Self-hosted runners          |       ⚠️        |        ✅         |
| GitHub-hosted runners        |       ✅        |        ☑️         |
| Local filesystem backend     |       ❌        |        ✅         |
| S3-compatible backend        |       ❌        |        ✅         |
| Google Cloud Storage backend |       ❌        |        ✅         |
| Configurable TTL             |       ❌        |        ✅         |
| Size limits / LRU eviction   |       ❌        |        ✅         |
| Compression options          |       ✔️        |        ✅         |
| Self-healing index           |       ❌        |        ✅         |

**Legend**

- ⚠️ = works, but with limitations
  > cache incurs slow network I/O to and from GitHub Actions server on every run
- ☑️ = requires S3 or GCS backend for GitHub-hosted runners
  > local disk backend not available on GitHub-hosted runners
- ✔️ = `zstd`, `gzip`, or `none` available in **OpenCache Actions**
  > only `zstd` is available in `actions/cache`

## Options

| Input                                  | Description                                    | Default                    |
| -------------------------------------- | ---------------------------------------------- | -------------------------- |
| **Core**                               |                                                |                            |
| `key`                                  | Primary cache key for save/restore             | _required_                 |
| `path`                                 | Files/directories to cache (newline-separated) | _required_                 |
| `restore-keys`                         | Fallback keys for partial matches              | -                          |
| **Behavior**                           |                                                |                            |
| `fail-on-cache-miss`                   | Fail workflow if no cache found                | `false`                    |
| `lookup-only`                          | Check existence without downloading            | `false`                    |
| `save-always`                          | Save cache even if previous steps fail         | `false`                    |
| **Storage**                            |                                                |                            |
| `storage-provider`                     | Backend: `local`, `s3`, or `gcs`               | `local`                    |
| `cache-path`                           | Base path for local cache                      | `~/.cache/gha-opencache`\* |
| **S3** _(when storage-provider: s3)_   |                                                |                            |
| `s3-bucket`                            | S3 bucket name                                 | _required_                 |
| `s3-region`                            | AWS region                                     | `us-east-1`                |
| `s3-endpoint`                          | Custom endpoint (MinIO, R2, Spaces)            | -                          |
| `s3-prefix`                            | Key prefix in bucket                           | `gha-cache/`               |
| `s3-force-path-style`                  | Path-style URLs (required for MinIO)           | `false`                    |
| **GCS** _(when storage-provider: gcs)_ |                                                |                            |
| `gcs-bucket`                           | GCS bucket name                                | _required_                 |
| `gcs-project`                          | GCP project ID                                 | -                          |
| `gcs-prefix`                           | Key prefix in bucket                           | `gha-cache/`               |
| `gcs-key-file`                         | Service account key file path                  | -                          |
| **Compression**                        |                                                |                            |
| `compression`                          | Algorithm: `auto`, `zstd`, `gzip`, `none`      | `auto`                     |
| `compression-level`                    | Level (zstd: 1-19, gzip: 1-9)                  | 3 / 6                      |
| **Lifecycle**                          |                                                |                            |
| `ttl-days`                             | Days until cache expires (0 = never)           | `7`                        |
| `max-cache-size-gb`                    | Max size per repo in GB (0 = unlimited)        | `10`                       |

- Platform-specific defaults: Linux: `$HOME/.cache/gha-opencache` (respects `XDG_CACHE_HOME` when set), macOS: `~/Library/Caches/gha-opencache`, Windows: `%LOCALAPPDATA%\gha-opencache`. Override with `OPENCACHE_PATH` env var.

**Environment variables for cloud storage:**

- S3: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- GCS: `GOOGLE_APPLICATION_CREDENTIALS` (or Workload Identity)

## Outputs

| Output              | Description                                      |
| ------------------- | ------------------------------------------------ |
| `cache-hit`         | `true` if exact match found for primary key      |
| `cache-primary-key` | The primary key that was used                    |
| `cache-matched-key` | Key of restored cache (may be unset if no match) |

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
key: npm-linux-xyz999 # doesn't exist
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

| Method           | Speed    | Ratio     | When to Use                       |
| ---------------- | -------- | --------- | --------------------------------- |
| `auto` (default) | -        | -         | Detects zstd → falls back to gzip |
| `zstd`           | Fast     | Excellent | Best for most cases               |
| `gzip`           | Moderate | Good      | Maximum compatibility             |
| `none`           | Fastest  | N/A       | Pre-compressed files              |

**Levels:** zstd 1-19 (default: 3), gzip 1-9 (default: 6)

> [examples/compression-tuning.yml](examples/compression-tuning.yml)

## Architecture

Designed for reliability with self-healing cache indexes and lock-free archive creation.

> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Technical deep dive

## Examples

> **📚 [Browse all examples →](examples/)**
>
> 16+ complete, production-ready workflow examples organized by category:
>
> - **Getting Started** - Node.js basic with detailed inline comments
> - **Storage Backends** - S3/MinIO, Cloudflare R2, Google Cloud Storage
> - **Advanced Features** - Multi-cache, restore-keys patterns, TTL/eviction, compression
> - **Language-Specific** - Python, Go, Rust with best practices
> - **Docker & Containers** - Volume mounts and container workflows
>
> Each example includes comprehensive documentation, real-world patterns, and troubleshooting guidance.

## Troubleshooting

**Enable debug:** `env: ACTIONS_STEP_DEBUG: true`

**Quick fixes:**

- **Not restoring** → Check key format, verify `restore-keys` prefixes
- **Docker containers** → Mount cache as volume: see [docs/DOCKER.md](docs/DOCKER.md)
- **Permission denied** → Default path is user-writable; if using custom `cache-path`, ensure directory exists with proper permissions
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
ls -la ~/.cache/gha-opencache/owner/repo/
```

Verify restore-keys have no trailing slashes or extra characters.

### Docker Containers

**Problem**: Cache saved in one job but not found in another.

**Cause**: Docker containers have isolated filesystems. Each container sees its own cache directory unless mounted from host.

**Quick fix** (set explicit cache path and mount it):

```yaml
jobs:
  build:
    runs-on: self-hosted
    container:
      image: my-image
      volumes:
        - /srv/gha-cache:/cache
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          cache-path: /cache
```

> **See [docs/DOCKER.md](docs/DOCKER.md)** for complete setup guide (container volumes, Kubernetes, Docker Compose, verification, troubleshooting).

### Permission Denied or Directory Missing

The default cache path (`~/.cache/gha-opencache`) is user-writable and should work without setup.

If using a custom `cache-path`, ensure the directory exists:

```bash
mkdir -p /your/custom/path
```

For shared/managed infrastructure, you can set `OPENCACHE_PATH` env var on all runners.

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
max-cache-size-gb: 5 # Reduce from default 10 GB
ttl-days: 3 # Shorter than default 7 days
compression-level: 9 # Increase compression
```

Manual cleanup:

```bash
find ~/.cache/gha-opencache -type f -mtime +7 -delete
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
