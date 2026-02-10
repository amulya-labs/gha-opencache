# Migration Guide

Migrating from `actions/cache` and setting up storage backends.

## From actions/cache

**Step 1:** Change `uses:` line from `actions/cache@v4` to `rrl-personal-projects/actions-opencache@v1`

**Step 2:** Choose storage backend (see sections below)

That's it. All inputs, outputs, and behavior are identical.

<details>
<summary>Optional: Configure Additional Features</summary>

`actions-opencache` adds optional features beyond `actions/cache`:

```yaml
# Configurable compression
compression: zstd
compression-level: 3

# Custom TTL
ttl-days: 7

# Custom size limit
max-cache-size-gb: 20
```

</details>

## Local Filesystem Setup

**1. Create cache directory:**

Linux/macOS:
```bash
sudo mkdir -p /srv/gha-cache/v1
sudo chown -R runner-user:runner-group /srv/gha-cache/v1
chmod 755 /srv/gha-cache/v1
```

Windows (PowerShell as Admin):
```powershell
New-Item -Path "C:\gha-cache\v1" -ItemType Directory -Force
# Grant runner-user full control via ACL
```

**2. Verify permissions:**

```bash
# Linux/macOS
sudo -u runner-user touch /srv/gha-cache/v1/test.txt && rm /srv/gha-cache/v1/test.txt
```

**3. Provision storage:**

```
Total = (repos) × (max-cache-size-gb) × 1.2 safety factor
Example: 5 repos × 10 GB × 1.2 = 60 GB minimum
```

<details>
<summary>Optional: Custom Cache Path</summary>

```yaml
cache-path: /mnt/ssd-cache/gha
```

</details>

<details>
<summary>Optional: Monitoring and Cleanup</summary>

**Disk monitoring (cron):**
```bash
0 */6 * * * df -h /srv/gha-cache | mail -s "Cache Usage" admin@example.com
```

**Manual cleanup:**
```bash
find /srv/gha-cache/v1 -type f -mtime +30 -delete
```

</details>

## S3-Compatible Storage Setup

All S3-compatible providers require:
1. Create bucket
2. Create access credentials with permissions: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`
3. Add credentials to GitHub repository secrets
4. Configure workflow with provider-specific settings

### Provider-Specific Configuration

<details>
<summary>AWS S3</summary>

**Create bucket:**
```bash
aws s3 mb s3://my-gha-cache-bucket --region us-west-2
```

**IAM Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
    "Resource": ["arn:aws:s3:::my-gha-cache-bucket", "arn:aws:s3:::my-gha-cache-bucket/*"]
  }]
}
```

**Workflow:**
```yaml
storage-provider: s3
s3-bucket: my-gha-cache-bucket
s3-region: us-west-2
# s3-endpoint: (omit for AWS S3)
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

</details>

<details>
<summary>MinIO</summary>

**Deploy (Docker):**
```bash
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=password123 \
  -v /mnt/data:/data --name minio \
  quay.io/minio/minio server /data --console-address ":9001"
```

**Create bucket:**
```bash
mc alias set myminio http://localhost:9000 admin password123
mc mb myminio/github-actions-cache
```

**Workflow:**
```yaml
storage-provider: s3
s3-bucket: github-actions-cache
s3-endpoint: https://minio.example.com
s3-region: us-east-1
s3-force-path-style: true  # Required for MinIO
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.MINIO_ACCESS_KEY }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.MINIO_SECRET_KEY }}
```

</details>

<details>
<summary>Cloudflare R2</summary>

**Create bucket:** Cloudflare Dashboard → R2 → Create bucket

**Create API token:** R2 → Manage R2 API Tokens → Create (Object Read & Write)

**Workflow:**
```yaml
storage-provider: s3
s3-bucket: my-gha-cache-bucket
s3-endpoint: https://<account-id>.r2.cloudflarestorage.com
s3-region: auto
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

</details>

<details>
<summary>DigitalOcean Spaces</summary>

**Create Space:** DigitalOcean Control Panel → Spaces → Create Space

**Create API key:** API → Tokens/Keys → Generate New Key (Spaces access)

**Workflow:**
```yaml
storage-provider: s3
s3-bucket: my-gha-cache
s3-endpoint: https://nyc3.digitaloceanspaces.com
s3-region: us-east-1
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.DO_SPACES_KEY }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.DO_SPACES_SECRET }}
```

</details>

## Testing Your Migration

**1. Test cache save:**
```yaml
- name: Save test cache
  uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: test.txt
    key: test-${{ github.run_number }}
```

**2. Test cache restore:**
```yaml
- name: Restore test cache
  id: cache
  uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: test.txt
    key: test-999
    restore-keys: test-

- run: echo "Hit=${{ steps.cache.outputs.cache-hit }} Key=${{ steps.cache.outputs.cache-matched-key }}"
```

**3. Verify storage:**

Local:
```bash
ls -lh /srv/gha-cache/v1/github.com/owner/repo/archives/
cat /srv/gha-cache/v1/github.com/owner/repo/index.json
```

S3:
```bash
aws s3 ls s3://my-gha-cache-bucket/gha-cache/ --recursive
```

**Troubleshooting checklist:**
- [ ] Cache directory has correct permissions
- [ ] Runner user can read/write cache directory
- [ ] Sufficient disk space
- [ ] S3 credentials valid (if using S3)
- [ ] S3 bucket accessible
- [ ] Cache key generates correctly
- [ ] restore-keys prefixes correct
- [ ] Debug logging enabled: `ACTIONS_STEP_DEBUG: true`

→ See [README.md#troubleshooting](README.md#troubleshooting) for detailed solutions
