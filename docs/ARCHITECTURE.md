# Architecture

Technical details on how gha-opencache achieves reliability and performance.

## Self-Healing Cache Index

The cache automatically recovers from index corruption:

- **Manifest Files**: Each archive has a `.meta.json` file with complete metadata
- **Automatic Rebuild**: Corrupted or missing index is reconstructed from manifests
- **Manual Rebuild**: Set `OPENCACHE_REBUILD_INDEX=1` to force rebuild
- **Temp Cleanup**: Stale temp files (>1 hour old) cleaned during index rebuild

### Recovery Scenarios

| Scenario | Recovery |
|----------|----------|
| Corrupted `index.json` | Automatic rebuild from manifests |
| Missing `index.json` | Rebuild if manifests exist, else empty |
| Interrupted save | Temp files ignored, cleaned after 1 hour |
| Partial manifest | Entry skipped, others recovered |

## Lock-Free Archive Creation

Archive creation happens without holding locks:

- **Phase 1**: Create archive (unlocked, can take minutes)
- **Phase 2**: Atomic commit (locked, ~10ms)

This prevents lock contention during concurrent saves.

## Storage Structure

**Local filesystem:**
```
{cache-path}/{owner}/{repo}/
  ├── index.json
  └── archives/
      ├── sha256-{hash}.tar.zst
      └── sha256-{hash}.tar.zst.meta.json
```

**S3/GCS:**
```
{prefix}{owner}/{repo}/
  ├── index.json
  └── archives/
      ├── sha256-{hash}.tar.{compression}
      └── sha256-{hash}.tar.{compression}.meta.json
```

## Cache Lifecycle

**TTL expiration:** Entries auto-delete after `ttl-days` (default: 7 days, 0=disable)

**LRU eviction:** Oldest entries removed when exceeding `max-cache-size-gb` (default: 10 GB/repo, 0=disable)

**Repository isolation:** Each repository has its own namespace, preventing key collisions across projects.
