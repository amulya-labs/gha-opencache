# Using gha-opencache with Docker Containers

→ **[Main Documentation](../README.md)** | **[Migration Guide](../MIGRATION.md)** | **[Examples](../examples/)**

When running GitHub Actions jobs inside Docker containers, you **must** mount the cache directory as a volume from the host to ensure caches are shared across containers.

> **Note**: The default cache path (`~/.cache/gha-opencache`) is inside the container's filesystem and won't persist. For Docker, always use an explicit `cache-path` that's mounted from the host.

## The Problem

**Each container has an isolated filesystem.** If you save a cache in one container and try to restore it in another container, the cache won't be found unless both containers mount the same host directory.

### Example Failure Scenario

```yaml
jobs:
  build:
    runs-on: self-hosted
    container: my-build-image  # ❌ Container 1 - isolated filesystem
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          path: target/
          key: build-cache
      # Cache saved to /srv/gha-cache INSIDE container

  test:
    needs: build
    runs-on: self-hosted
    container: my-test-image   # ❌ Container 2 - different isolated filesystem
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          path: target/
          key: build-cache
      # Cache not found! Different container = different /srv/gha-cache
```

**Result**: Build saves cache successfully, Test can't find it 13 seconds later.

## The Solution

Mount the cache directory from the **host** into **all** containers that need to share caches.

### Option 1: Container-level Volume Mounts (Recommended)

```yaml
jobs:
  build:
    runs-on: self-hosted
    container:
      image: my-build-image
      volumes:
        - /srv/gha-cache:/cache  # ✅ Mount host directory
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          path: target/
          key: build-${{ hashFiles('**/Cargo.lock') }}
          cache-path: /cache  # ✅ Use mounted path

  test:
    needs: build
    runs-on: self-hosted
    container:
      image: my-test-image
      volumes:
        - /srv/gha-cache:/cache  # ✅ Same host directory
    steps:
      - uses: amulya-labs/gha-opencache@v2
        with:
          path: target/
          key: build-${{ hashFiles('**/Cargo.lock') }}
          cache-path: /cache  # ✅ Use mounted path
```

**How it works**:
- Both containers mount `/srv/gha-cache` from the **host** to `/cache` in the **container**
- `cache-path: /cache` tells the action to use the mounted directory
- Build saves to `/cache/owner/repo/` (which writes to host)
- Test reads from `/cache/owner/repo/` (which reads from host)
- Caches are shared! ✅

### Option 2: Custom Cache Path

If you can't modify container volumes, use a different cache path that's already mounted:

```yaml
- uses: amulya-labs/gha-opencache@v2
  with:
    path: target/
    key: build-cache
    cache-path: /tmp/gha-cache  # Use a path that's shared across containers
```

Then mount `/tmp/gha-cache` from the host:

```yaml
container:
  image: my-image
  volumes:
    - /tmp/gha-cache:/tmp/gha-cache
```

### Option 3: Runner Working Directory

GitHub Actions runner working directory (`${{ runner.workspace }}`) is typically mounted from the host. You can use this:

```yaml
- uses: amulya-labs/gha-opencache@v2
  with:
    path: target/
    key: build-cache
    cache-path: ${{ runner.workspace }}/.cache
```

**Note**: This may be cleaned up between runs, so less ideal for persistent caching.

## Verification

After configuring volumes, verify the setup:

```yaml
- name: Verify cache volume
  run: |
    echo "Cache directory from container:"
    ls -la /srv/gha-cache/ || echo "Cache directory not mounted!"
    echo ""
    echo "Container ID:"
    cat /proc/self/cgroup | grep docker
    echo ""
    echo "Mounted volumes:"
    mount | grep gha-cache
```

## Troubleshooting

### Problem: Cache saved but not found

**Symptom**: Build job saves cache successfully, test job reports "cache not found" seconds later.

**Diagnosis**:
```yaml
- name: Debug cache state
  run: |
    echo "=== Cache directory exists? ==="
    ls -la /srv/gha-cache/

    echo "=== Is it mounted from host? ==="
    mount | grep gha-cache || echo "NOT MOUNTED - This is the problem!"

    echo "=== Container info ==="
    hostname
    cat /proc/self/cgroup | head -5
```

**Solution**: Add volume mount to container configuration (see examples above).

### Problem: Permission denied

**Symptom**: `Permission denied writing cache index` or similar errors.

**Cause**: Container runs as different user than host directory owner, or cache path isn't writable.

**Solutions**:

1. **Use a user-writable path** (simplest):
```yaml
- uses: amulya-labs/gha-opencache@v2
  with:
    cache-path: /tmp/gha-cache  # Writable by all users
```

2. **Fix host directory permissions**:
```bash
sudo chown -R 1000:1000 /srv/gha-cache
# Or make it world-writable (less secure)
sudo chmod -R 777 /srv/gha-cache
```

3. **Run container as specific user**:
```yaml
container:
  image: my-image
  options: --user 1000:1000
  volumes:
    - /srv/gha-cache:/srv/gha-cache
```

### Problem: Multiple runners conflict

**Symptom**: Caches corrupted or lock timeouts.

**Cause**: Multiple runners on same host writing to same cache directory simultaneously.

**Solution**: Use separate cache directories per runner:
```yaml
- uses: amulya-labs/gha-opencache@v2
  with:
    cache-path: /srv/gha-cache/${{ runner.name }}
```

---

## Advanced Setup

<details>
<summary><strong>Docker Compose</strong></summary>

If using Docker Compose for your self-hosted runner:

```yaml
services:
  github-runner:
    image: myoung34/github-runner:latest
    volumes:
      # Mount cache directory from host
      - /srv/gha-cache:/srv/gha-cache
      # Also mount Docker socket for container jobs
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      RUNNER_NAME: my-runner
      RUNNER_WORKDIR: /tmp/runner
```

</details>

<details>
<summary><strong>Kubernetes / Actions Runner Controller</strong></summary>

For Kubernetes-based runners using [actions-runner-controller](https://github.com/actions/actions-runner-controller):

```yaml
apiVersion: actions.summerwind.dev/v1alpha1
kind: RunnerDeployment
metadata:
  name: my-runners
spec:
  template:
    spec:
      dockerdWithinRunnerContainer: true
      volumes:
        - name: cache-volume
          hostPath:
            path: /srv/gha-cache
            type: DirectoryOrCreate
      volumeMounts:
        - name: cache-volume
          mountPath: /srv/gha-cache
      # Also need to mount to dind container
      dockerVolumeMounts:
        - name: cache-volume
          mountPath: /srv/gha-cache
```

**Important**: With `dockerdWithinRunnerContainer: true`, you must add the volume to **both** the runner container and the dind (Docker-in-Docker) container using `dockerVolumeMounts`.

See: [actions-runner-controller custom volumes docs](https://github.com/actions/actions-runner-controller/blob/master/docs/using-custom-volumes.md)

</details>

<details>
<summary><strong>Complete Rust Build Example</strong></summary>

```yaml
name: Rust CI

on: [push, pull_request]

jobs:
  prepare-image:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - name: Build CI image
        run: docker build -t rust-ci:latest -f Dockerfile.ci .

  build:
    needs: prepare-image
    runs-on: self-hosted
    container:
      image: rust-ci:latest
      volumes:
        - /srv/gha-cache:/srv/gha-cache  # ✅ Mount cache from host
    steps:
      - uses: actions/checkout@v4

      - name: Cache cargo registry
        uses: amulya-labs/gha-opencache@v2
        with:
          path: ~/.cargo/registry
          key: cargo-registry-${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo target
        uses: amulya-labs/gha-opencache@v2
        with:
          path: target/
          key: cargo-target-${{ runner.os }}-${{ hashFiles('**/Cargo.lock') }}

      - name: Build
        run: cargo build --release

  test:
    needs: build
    runs-on: self-hosted
    container:
      image: rust-ci:latest
      volumes:
        - /srv/gha-cache:/srv/gha-cache  # ✅ Same mount
    steps:
      - uses: actions/checkout@v4

      - name: Restore cargo target
        uses: amulya-labs/gha-opencache@v2
        with:
          path: target/
          key: cargo-target-${{ runner.os }}-${{ hashFiles('**/Cargo.lock') }}

      - name: Test
        run: cargo test --release
```

</details>

<details>
<summary><strong>Quick Checklist</strong></summary>

Before deploying:
- [ ] Cache directory mounted as volume in **all** container jobs
- [ ] Using absolute paths (e.g., `/srv/gha-cache`)
- [ ] Same path mounted in all containers
- [ ] Permissions set correctly (1000:1000 or 777)
- [ ] Verified mounts with debug commands
- [ ] Separate cache dirs if multiple runners on same host

</details>

---

## References

- [GitHub Actions Runner Controller - Custom Volumes](https://github.com/actions/actions-runner-controller/blob/master/docs/using-custom-volumes.md)
- [Docker Build Cache in GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/)
- [Self-hosted Runner Caching Discussion](https://github.com/orgs/community/discussions/18549)
- [myoung34/docker-github-actions-runner](https://github.com/myoung34/docker-github-actions-runner)
