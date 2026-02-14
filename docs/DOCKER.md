# Using gha-opencache with Docker Containers

This guide explains how to use gha-opencache in containerized GitHub Actions workflows.

## Quick Start

If you're running workflows in Docker containers, you **must** specify an explicit `cache-path` that points to a mounted volume:

```yaml
jobs:
  my-job:
    runs-on: self-hosted
    container:
      image: python:3.11
      volumes:
        - /srv/gha-cache:/srv/gha-cache  # Mount a volume

    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          path: .venv
          key: deps-${{ hashFiles('**/requirements.txt') }}
          cache-path: /srv/gha-cache  # ← Required! Points to mounted volume
```

## Why is this necessary?

### The Problem

Docker containers have **isolated filesystems**. When a container exits, everything in its filesystem is lost unless it's stored on a mounted volume.

**gha-opencache v2** changed the default cache path from `/srv/gha-cache` (absolute) to `$HOME/.cache/gha-opencache` (user-relative):

```yaml
# Inside a container:
# $HOME = /github/home
# Default cache path = /github/home/.cache/gha-opencache
# This path is INSIDE the container's ephemeral filesystem!
```

**Result**: Without an explicit `cache-path`, caches are stored in the container's ephemeral filesystem and lost when the container exits.

### The Solution

1. **Mount a volume** in your container config
2. **Set `cache-path`** to point to the mounted volume

The cache is then stored on the host's persistent filesystem and survives container restarts.

## Complete Examples

### GitHub Actions with Docker Container

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: self-hosted
    container:
      image: node:20
      volumes:
        - /var/cache/actions:/var/cache/actions  # Persistent volume

    steps:
      - uses: actions/checkout@v4
      
      - name: Cache node_modules
        uses: amulya-labs/gha-opencache@v2
        with:
          path: node_modules
          key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          cache-path: /var/cache/actions  # Must match mounted volume

      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
```

### Multiple Caches in One Job

```yaml
jobs:
  build:
    runs-on: self-hosted
    container:
      image: python:3.11
      volumes:
        - /srv/gha-cache:/srv/gha-cache

    steps:
      - uses: actions/checkout@v4

      # All caches use the same cache-path
      - name: Cache Python dependencies
        uses: amulya-labs/gha-opencache@v2
        with:
          path: .venv
          key: poetry-${{ hashFiles('poetry.lock') }}
          cache-path: /srv/gha-cache

      - name: Cache Ruff
        uses: amulya-labs/gha-opencache@v2
        with:
          path: .ruff_cache
          key: ruff-${{ hashFiles('src/**/*.py') }}
          cache-path: /srv/gha-cache

      - name: Cache pytest
        uses: amulya-labs/gha-opencache@v2
        with:
          path: .pytest_cache
          key: pytest-${{ hashFiles('tests/**/*.py') }}
          cache-path: /srv/gha-cache
```

### Kubernetes Pods

For Kubernetes runners, use persistent volumes:

```yaml
jobs:
  build:
    runs-on: self-hosted
    container:
      image: gradle:jdk17
      volumes:
        - /mnt/k8s-cache:/cache  # Persistent volume claim

    steps:
      - uses: actions/checkout@v4

      - name: Cache Gradle
        uses: amulya-labs/gha-opencache@v2
        with:
          path: ~/.gradle/caches
          key: gradle-${{ hashFiles('**/*.gradle*') }}
          cache-path: /cache  # Must match container mount point
```

## Upgrading from v1 to v2

If you're upgrading from `gha-opencache@v1` and use containers, you **must** add `cache-path`:

### Before (v1 - worked without cache-path)

```yaml
- uses: amulya-labs/gha-opencache@v1
  with:
    path: .venv
    key: deps-${{ hashFiles('poetry.lock') }}
    # No cache-path needed - v1 defaulted to /srv/gha-cache
```

### After (v2 - requires explicit cache-path)

```yaml
- uses: amulya-labs/gha-opencache@v2
  with:
    path: .venv
    key: deps-${{ hashFiles('poetry.lock') }}
    cache-path: /srv/gha-cache  # ← Now required!
```

**Important**: Make sure your container mounts the volume:

```yaml
container:
  image: python:3.11
  volumes:
    - /srv/gha-cache:/srv/gha-cache  # ← Must match cache-path
```

## Automatic Detection and Warnings

Starting in v2.1.0, gha-opencache automatically detects when you're running in a container and warns if cache configuration might be incorrect:

### Warning: Default Path in Container

```
Warning: Cache miss in container using default cache path: /github/home/.cache/gha-opencache

❌ Default path is NOT mounted (detected: not-mounted)

Container filesystems are isolated - the default cache path is inside
the container and will not persist between jobs.

To fix, add an explicit cache-path with a mounted volume:

  - uses: amulya-labs/gha-opencache@v2
    with:
      cache-path: /srv/gha-cache

  container:
    volumes:
      - /srv/gha-cache:/srv/gha-cache
```

### Warning: Path Not Mounted

```
Warning: Cache miss in container using cache path: /srv/gha-cache

❌ This path does NOT appear to be mounted as a volume!
The cache is stored in the container's ephemeral filesystem and
will be lost when the container exits.

Add a volume mount in your workflow:
  container:
    volumes:
      - /srv/gha-cache:/srv/gha-cache
```

### Warning: First Run (Path IS Mounted)

```
Warning: Cache miss in container using cache path: /srv/gha-cache

✅ Path appears to be mounted as a volume.
If this is the first run, this cache miss is expected.
Otherwise, verify:
1. The host directory exists and has correct permissions
2. The cache key matches previous runs
```

## Troubleshooting

### Cache Misses on Every Run

**Symptom**: Cache never hits, dependencies reinstall every time

**Cause**: Cache stored in ephemeral container filesystem

**Solution**: Add explicit `cache-path` pointing to mounted volume

```yaml
# Before (broken)
- uses: amulya-labs/gha-opencache@v2
  with:
    path: .venv
    key: deps-${{ hashFiles('poetry.lock') }}
    # Missing cache-path!

# After (fixed)
- uses: amulya-labs/gha-opencache@v2
  with:
    path: .venv
    key: deps-${{ hashFiles('poetry.lock') }}
    cache-path: /srv/gha-cache  # ← Added
```

### Permission Errors

**Symptom**: `Permission denied` when saving cache

**Cause**: Host directory doesn't exist or has wrong permissions

**Solution**: Create directory and set permissions on the host:

```bash
# On the runner host (not in container)
sudo mkdir -p /srv/gha-cache
sudo chown -R 1001:1001 /srv/gha-cache  # Use your runner user ID
sudo chmod -R 755 /srv/gha-cache
```

### Mount Path Mismatch

**Symptom**: Cache saves but doesn't restore

**Cause**: Volume mount path and cache-path don't match

**Solution**: Ensure paths match exactly:

```yaml
container:
  volumes:
    - /srv/gha-cache:/srv/gha-cache
    #   ^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^
    #   Host path      Container path
    
steps:
  - uses: amulya-labs/gha-opencache@v2
    with:
      cache-path: /srv/gha-cache  # ← Must match container path
```

### Cache Path Inside $HOME

**Symptom**: Warning about ephemeral path

**Cause**: Cache path is under `/github/home` (container's home)

**Solution**: Use a path outside the container's home directory:

```yaml
# Bad - inside container home (ephemeral)
cache-path: /github/home/.cache
cache-path: ~/.cache/gha-opencache

# Good - mounted volume (persistent)
cache-path: /srv/gha-cache
cache-path: /var/cache/actions
cache-path: /mnt/cache
```

## Best Practices

### 1. Use Consistent Cache Paths

Pick one cache path and use it for all jobs:

```yaml
# Good - all jobs use same path
jobs:
  test:
    container:
      volumes:
        - /srv/gha-cache:/srv/gha-cache
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          cache-path: /srv/gha-cache

  build:
    container:
      volumes:
        - /srv/gha-cache:/srv/gha-cache
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          cache-path: /srv/gha-cache
```

### 2. Document Why cache-path Is Needed

Add comments explaining the container requirement:

```yaml
- name: Cache dependencies
  # NOTE: cache-path required for container-based jobs
  # Without it, v2 uses $HOME/.cache/gha-opencache (ephemeral)
  uses: amulya-labs/gha-opencache@v2
  with:
    path: node_modules
    cache-path: /srv/gha-cache  # Use mounted volume (persists across runs)
    key: npm-${{ hashFiles('package-lock.json') }}
```

### 3. Verify Volume Mounts

Always double-check that:
- Volume is mounted: `container.volumes` includes your cache path
- Paths match: Container mount path = `cache-path` value
- Host directory exists and has correct permissions

### 4. Use Environment Variables for Consistency

Define cache path once and reuse:

```yaml
env:
  CACHE_PATH: /srv/gha-cache

jobs:
  test:
    container:
      volumes:
        - ${{ env.CACHE_PATH }}:${{ env.CACHE_PATH }}
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          cache-path: ${{ env.CACHE_PATH }}
```

## Non-Container Workflows

If you're **not** using containers, `cache-path` is **optional**. The default user-relative path works fine:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest  # No container
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          path: .venv
          key: deps-${{ hashFiles('poetry.lock') }}
          # No cache-path needed - default works!
```

## Getting Help

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section above
2. Look for warning messages in your workflow logs
3. Verify volume mounts with: `docker inspect <container-id>`
4. Open an issue: https://github.com/amulya-labs/gha-opencache/issues

## See Also

- [Main README](../README.md)
- [API Documentation](./API.md)
- [Migration Guide](./MIGRATION.md)
