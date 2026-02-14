# OpenCache Actions Examples

This directory contains comprehensive workflow examples demonstrating various use cases and configurations for `gha-opencache`. Each example is a complete, runnable workflow that you can adapt for your projects.

## 📚 Table of Contents

- [Getting Started](#-getting-started)
- [Storage Backends](#-storage-backends)
- [Advanced Features](#-advanced-features)
- [Language-Specific Examples](#-language-specific-examples)
- [Docker & Containers](#-docker--containers)

---

## 🚀 Getting Started

Perfect for first-time users and simple use cases.

### [node-basic.yml](node-basic.yml)
**Basic Node.js dependency caching with restore-keys fallback**

- Local filesystem storage (for self-hosted runners)
- Exact cache key matching on `package-lock.json`
- Branch-based fallback with restore-keys
- Fast builds with no external dependencies

**Best for:** Self-hosted runners, simple Node.js projects

---

## 💾 Storage Backends

Examples using different storage providers for various infrastructure setups.

### [s3-minio.yml](s3-minio.yml)
**Using MinIO S3-compatible storage backend**

- Works on both GitHub-hosted and self-hosted runners
- Self-hosted MinIO for complete control
- Path-style S3 API configuration
- Custom endpoint support

**Best for:** Organizations with existing MinIO infrastructure

### [s3-cloudflare-r2.yml](s3-cloudflare-r2.yml)
**Cloudflare R2 storage (S3-compatible)**

- Low-cost storage with zero egress fees
- Works on both GitHub-hosted and self-hosted runners
- Optimized for Next.js projects
- Advanced compression with zstd

**Best for:** Cost-conscious teams, global distribution needs

### [gcs-basic.yml](gcs-basic.yml)
**Google Cloud Storage with service account key authentication**

- Works on both GitHub-hosted and self-hosted runners
- Service account key-based authentication
- Integration with existing GCP infrastructure
- Full control over retention and costs

**Best for:** Teams already using Google Cloud Platform

### [gcs-workload-identity.yml](gcs-workload-identity.yml)
**Google Cloud Storage with Workload Identity (keyless authentication)**

- Enhanced security with keyless authentication
- Automatic credential rotation
- No service account keys to manage
- Works on both GitHub-hosted and self-hosted runners

**Best for:** Security-conscious teams, production environments

---

## ⚙️ Advanced Features

Sophisticated caching strategies and optimizations.

### [multi-cache.yml](multi-cache.yml)
**Using multiple independent caches in one workflow**

- Separate caches for dependencies, build artifacts, and coverage
- Independent invalidation strategies
- Optimized cache key patterns
- Maximum reuse efficiency

**Best for:** Complex builds with multiple cacheable artifacts

### [restore-keys-advanced.yml](restore-keys-advanced.yml)
**Advanced restore-keys patterns for real-world scenarios**

- Branch-based cache fallback chains
- Monorepo workspace caching
- Dependency update strategies
- Time-based cache rotation
- Cross-platform caching

**Best for:** Large monorepos, complex branching strategies

### [lookup-only.yml](lookup-only.yml)
**Check cache existence without downloading**

- Fast cache validation (metadata check only)
- Conditional workflow paths based on cache availability
- Matrix build optimization
- Cache warming strategies

**Best for:** Matrix builds, conditional workflows, expensive caches

### [fail-on-cache-miss.yml](fail-on-cache-miss.yml)
**Enforce strict cache requirements**

- Workflow fails if required cache is not found
- Guaranteed dependencies in production deployments
- Multi-stage pipeline validation
- Configuration error detection

**Best for:** Production deployments, downstream jobs requiring upstream artifacts

### [save-always.yml](save-always.yml)
**Save cache even when workflow fails**

- Preserves partial results on failure
- Incremental compilation support (C++, Rust, TypeScript)
- Test coverage accumulation
- Faster recovery from failures

**Best for:** Incremental builds, long-running compilations

### [ttl-and-eviction.yml](ttl-and-eviction.yml)
**Automatic cache management with TTL and size limits**

- Automatic expiration of old caches (TTL)
- LRU eviction when storage limit exceeded
- Hands-free cache lifecycle management
- Disk space management

**Best for:** Shared runners, compliance requirements, cost control

### [compression-tuning.yml](compression-tuning.yml)
**Different compression strategies for various use cases**

- Auto, zstd, gzip, and no compression examples
- Compression level tuning
- Performance vs. size trade-offs
- Use case-specific optimization

**Best for:** Large caches, network-constrained environments

---

## 🔧 Language-Specific Examples

Ready-to-use examples for popular programming languages and frameworks.

### [python-pip.yml](python-pip.yml)
**Python pip package caching**

- Multi-level restore-keys fallback
- Python version-specific caching
- Graceful degradation when dependencies change

**Best for:** Python projects with pip dependencies

### [go-modules.yml](go-modules.yml)
**Go modules and build artifacts caching**

- Separate caches for modules (`go.sum`) and build artifacts
- Incremental compilation support
- Multiple cache usage patterns

**Best for:** Go projects with module dependencies

### [rust-cargo.yml](rust-cargo.yml)
**Rust Cargo registry, index, and build artifacts**

- Three-tier caching strategy (registry, git, build)
- Optimized for Rust's compilation model
- Incremental build support

**Best for:** Rust projects using Cargo

---

## 🐳 Docker & Containers

Special configurations for containerized workflows.

### [docker-containers.yml](docker-containers.yml)
**Comprehensive guide for using gha-opencache in containers**

- Single container workflows
- Service containers (multi-container setups)
- Kubernetes runners
- Matrix builds with containers
- Volume mount configuration
- Container detection and validation
- Automatic warnings for misconfiguration

**Best for:** Any workflow using Docker containers, Kubernetes runners

**⚠️ Important:** Containers require explicit `cache-path` and volume mount configuration. This example includes detailed documentation on avoiding common pitfalls.

---

## 🎯 How to Use These Examples

1. **Browse by category** to find the example that matches your use case
2. **Read the comments** in each example file for detailed explanations
3. **Copy and adapt** the example to your workflow
4. **Test incrementally** starting with basic examples before moving to advanced patterns

## 📖 Additional Resources

- [Main README](../README.md) - Project overview and API reference
- [MIGRATION.md](../MIGRATION.md) - Detailed setup instructions for storage backends
- [CONTRIBUTING.md](../CONTRIBUTING.md) - How to contribute to the project

## 💡 Tips

- **Start simple:** Begin with `node-basic.yml` or your language-specific example
- **Test locally first:** Use local filesystem storage on self-hosted runners before moving to cloud storage
- **Monitor cache hit rates:** Use `cache-hit` output to validate your caching strategy
- **Enable debug logging:** Set `ACTIONS_STEP_DEBUG: true` for troubleshooting
- **Read inline comments:** Each example file contains extensive documentation

## 🆘 Need Help?

- Check the inline comments in each example file - they contain detailed explanations
- Review the [main README](../README.md) for API documentation
- Open an issue if you have questions or need assistance
