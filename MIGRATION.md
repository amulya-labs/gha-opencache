# Migration Guide

This guide covers migrating to `actions-opencache` from `actions/cache` and setting up the required infrastructure.

## Table of Contents

- [From actions/cache](#from-actionscache)
- [Self-Hosted Runner Setup](#self-hosted-runner-setup)
- [S3 Backend Setup](#s3-backend-setup)
- [Testing Your Migration](#testing-your-migration)

## From actions/cache

`actions-opencache` is 100% API-compatible with `actions/cache`, making migration straightforward.

### Step 1: Update the `uses:` Line

**Before** (actions/cache):
```yaml
- uses: actions/cache@v4
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-
```

**After** (actions-opencache):
```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-
```

That's it! All inputs, outputs, and behavior remain the same.

### Step 2: Choose Storage Backend

#### Option A: Local Filesystem (Default)

No additional configuration needed. Ensure your self-hosted runner has the cache directory set up (see [Self-Hosted Runner Setup](#self-hosted-runner-setup)).

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    # storage-provider: local is the default
```

#### Option B: S3-Compatible Storage

Add S3 configuration and credentials:

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

    # S3 backend
    storage-provider: s3
    s3-bucket: my-gha-cache-bucket
    s3-region: us-west-2
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

See [S3 Backend Setup](#s3-backend-setup) for detailed configuration.

### Behavior Differences

**None expected.** The action is designed to be a drop-in replacement with identical behavior:

- Same cache key matching algorithm
- Same restore-keys prefix matching (newest-first)
- Same outputs (cache-hit, cache-primary-key, cache-matched-key)
- Same cross-platform support (Linux, macOS, Windows)

### Additional Options

`actions-opencache` adds several optional features not available in `actions/cache`:

#### Configurable Compression

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    compression: zstd  # or gzip, none
    compression-level: 3  # 1-19 for zstd, 1-9 for gzip
```

#### Custom TTL

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    ttl-days: 7  # Delete after 7 days (default: 30)
```

#### Custom Size Limit

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    max-cache-size-gb: 20  # Limit to 20 GB per repo (default: 10)
```

## Self-Hosted Runner Setup

### Prerequisites

- Self-hosted GitHub Actions runner
- Disk space for caches (default: 10 GB per repository)
- Linux, macOS, or Windows operating system

### Local Storage Setup

#### 1. Create Cache Directory

On the machine running your self-hosted runner:

**Linux/macOS**:
```bash
# Create directory (as root or with sudo)
sudo mkdir -p /srv/gha-cache/v1

# Change ownership to runner user
sudo chown -R runner-user:runner-group /srv/gha-cache/v1

# Set permissions (read/write for owner, read for others)
chmod 755 /srv/gha-cache/v1
```

**Windows** (PowerShell as Administrator):
```powershell
# Create directory
New-Item -Path "C:\gha-cache\v1" -ItemType Directory -Force

# Grant runner user full control
$acl = Get-Acl "C:\gha-cache\v1"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "runner-user", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"
)
$acl.SetAccessRule($rule)
Set-Acl "C:\gha-cache\v1" $acl
```

Replace `runner-user` with the actual user account running your GitHub Actions runner.

#### 2. Verify Permissions

**Linux/macOS**:
```bash
# Test write access
sudo -u runner-user touch /srv/gha-cache/v1/test.txt
sudo -u runner-user rm /srv/gha-cache/v1/test.txt
```

**Windows**:
```powershell
# Test write access as runner user
Test-Path "C:\gha-cache\v1" -PathType Container
```

#### 3. Configure Custom Path (Optional)

If you want to use a different location, set the `cache-path` input:

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    cache-path: /mnt/ssd-cache/gha  # Custom location
```

#### 4. Provision Storage

Estimate storage requirements:

```
Total storage = (number of repos) × (max-cache-size-gb per repo) × (1.2 safety factor)
```

Example:
- 5 repositories
- 10 GB max cache size per repo (default)
- Safety factor: 1.2

Total: 5 × 10 × 1.2 = **60 GB minimum**

#### 5. Set Up Monitoring

Monitor disk usage to prevent the cache from filling the disk:

**Linux/macOS** (cron job):
```bash
# Add to crontab (crontab -e)
0 */6 * * * df -h /srv/gha-cache | mail -s "GHA Cache Disk Usage" admin@example.com
```

**Windows** (Task Scheduler):
```powershell
# Create task to check disk space every 6 hours
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument '-Command "Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json | Out-File C:\gha-cache-usage.json"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 6)
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "GHA-Cache-Monitor"
```

#### 6. Manual Cleanup (Optional)

To manually clean up old caches:

**Linux/macOS**:
```bash
# Remove caches older than 30 days
find /srv/gha-cache/v1 -type f -name "*.tar.*" -mtime +30 -delete
```

**Windows**:
```powershell
# Remove caches older than 30 days
Get-ChildItem -Path "C:\gha-cache\v1" -Recurse -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force
```

## S3 Backend Setup

### AWS S3

#### 1. Create S3 Bucket

```bash
# Using AWS CLI
aws s3 mb s3://my-gha-cache-bucket --region us-west-2
```

Or use the AWS Console:
1. Go to S3 service
2. Click "Create bucket"
3. Name: `my-gha-cache-bucket`
4. Region: Choose closest to your runners
5. Block all public access: **Enabled**
6. Versioning: Optional
7. Create bucket

#### 2. Create IAM Policy

Create a policy with minimal required permissions:

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

#### 3. Create IAM User (or Use IAM Role)

**Option A: IAM User** (for runners outside AWS):

```bash
# Create user
aws iam create-user --user-name gha-cache-user

# Attach policy
aws iam attach-user-policy --user-name gha-cache-user --policy-arn arn:aws:iam::ACCOUNT_ID:policy/GHA-Cache-Policy

# Create access key
aws iam create-access-key --user-name gha-cache-user
```

**Option B: IAM Role** (for EC2 runners):

```bash
# Attach role to EC2 instance
aws iam attach-role-policy --role-name ec2-runner-role --policy-arn arn:aws:iam::ACCOUNT_ID:policy/GHA-Cache-Policy
```

#### 4. Configure GitHub Secrets

Add credentials to your repository secrets:

1. Go to repository Settings → Secrets and variables → Actions
2. Add secrets:
   - `AWS_ACCESS_KEY_ID`: Your access key ID
   - `AWS_SECRET_ACCESS_KEY`: Your secret access key

#### 5. Use in Workflow

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

    storage-provider: s3
    s3-bucket: my-gha-cache-bucket
    s3-region: us-west-2
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### MinIO

#### 1. Deploy MinIO

**Docker**:
```bash
docker run -d \
  -p 9000:9000 -p 9001:9001 \
  -e "MINIO_ROOT_USER=admin" \
  -e "MINIO_ROOT_PASSWORD=password123" \
  -v /mnt/data:/data \
  --name minio \
  quay.io/minio/minio server /data --console-address ":9001"
```

**Kubernetes** (Helm):
```bash
helm repo add minio https://charts.min.io/
helm install minio minio/minio \
  --set rootUser=admin \
  --set rootPassword=password123 \
  --set persistence.size=100Gi
```

#### 2. Create Bucket

Access MinIO Console (http://localhost:9001) and create bucket `github-actions-cache`.

Or use `mc` CLI:
```bash
mc alias set myminio http://localhost:9000 admin password123
mc mb myminio/github-actions-cache
```

#### 3. Create Access Key

In MinIO Console:
1. Go to Identity → Users
2. Create new user or use existing
3. Create access key
4. Save access key ID and secret key

#### 4. Configure GitHub Secrets

Add to repository secrets:
- `MINIO_ACCESS_KEY`: Access key ID
- `MINIO_SECRET_KEY`: Secret key

#### 5. Use in Workflow

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

    storage-provider: s3
    s3-bucket: github-actions-cache
    s3-endpoint: https://minio.example.com
    s3-region: us-east-1
    s3-force-path-style: true  # Required for MinIO
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.MINIO_ACCESS_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.MINIO_SECRET_KEY }}
```

### Cloudflare R2

#### 1. Create R2 Bucket

1. Log in to Cloudflare Dashboard
2. Go to R2 → Create bucket
3. Name: `my-gha-cache-bucket`
4. Location: Automatic
5. Create bucket

#### 2. Create API Token

1. Go to R2 → Manage R2 API Tokens
2. Click "Create API token"
3. Permissions: Object Read & Write
4. TTL: Optional
5. Create token
6. Save Access Key ID and Secret Access Key

#### 3. Configure GitHub Secrets

Add to repository secrets:
- `R2_ACCESS_KEY_ID`: R2 access key ID
- `R2_SECRET_ACCESS_KEY`: R2 secret access key

#### 4. Use in Workflow

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

    storage-provider: s3
    s3-bucket: my-gha-cache-bucket
    s3-endpoint: https://<account-id>.r2.cloudflarestorage.com
    s3-region: auto
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

Replace `<account-id>` with your Cloudflare account ID (found in R2 dashboard).

## Testing Your Migration

### 1. Test Cache Save

Create a simple workflow to test cache saving:

```yaml
name: Test Cache Save

on: workflow_dispatch

jobs:
  test-save:
    runs-on: self-hosted  # or ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Create test data
        run: echo "test data" > test.txt

      - name: Save cache
        uses: rrl-personal-projects/actions-opencache@v1
        with:
          path: test.txt
          key: test-cache-${{ github.run_number }}
```

Run the workflow and check for errors.

### 2. Test Cache Restore

Create a workflow to test cache restoration:

```yaml
name: Test Cache Restore

on: workflow_dispatch

jobs:
  test-restore:
    runs-on: self-hosted

    steps:
      - uses: actions/checkout@v4

      - name: Restore cache
        id: cache
        uses: rrl-personal-projects/actions-opencache@v1
        with:
          path: test.txt
          key: test-cache-999  # Use a non-existent key
          restore-keys: |
            test-cache-

      - name: Verify cache
        run: |
          echo "Cache hit: ${{ steps.cache.outputs.cache-hit }}"
          echo "Matched key: ${{ steps.cache.outputs.cache-matched-key }}"
          if [ -f test.txt ]; then
            cat test.txt
          else
            echo "Cache file not found!"
            exit 1
          fi
```

Expected result:
- `cache-hit: false` (prefix match, not exact)
- `cache-matched-key: test-cache-<number>` (from previous test)
- File `test.txt` should exist with content "test data"

### 3. Test Storage Backend

#### Local Storage:
```bash
# Check if cache was created
ls -lh /srv/gha-cache/v1/github.com/<owner>/<repo>/archives/

# Check metadata
cat /srv/gha-cache/v1/github.com/<owner>/<repo>/index.json | jq
```

#### S3 Storage:
```bash
# List cache objects
aws s3 ls s3://my-gha-cache-bucket/gha-cache/ --recursive
```

### 4. Test Compression

Test different compression methods:

```yaml
- uses: rrl-personal-projects/actions-opencache@v1
  with:
    path: node_modules
    key: test-compression-${{ matrix.compression }}
    compression: ${{ matrix.compression }}
  strategy:
    matrix:
      compression: [auto, zstd, gzip, none]
```

### 5. Test Cross-Platform

If you have multiple runner platforms, test cache behavior across them:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]

runs-on: ${{ matrix.os }}

steps:
  - uses: rrl-personal-projects/actions-opencache@v1
    with:
      path: test-data
      key: cross-platform-${{ runner.os }}-test
      restore-keys: |
        cross-platform-${{ runner.os }}-
```

### Troubleshooting Checklist

- [ ] Cache directory exists and has correct permissions
- [ ] Runner user can read/write to cache directory
- [ ] Disk space is sufficient
- [ ] S3 credentials are valid (if using S3)
- [ ] S3 bucket exists and is accessible (if using S3)
- [ ] Cache key is being generated correctly
- [ ] restore-keys prefixes are correct (no typos)
- [ ] Debug logging is enabled (`ACTIONS_STEP_DEBUG: true`)

If issues persist, check the [Troubleshooting](README.md#troubleshooting) section in the main README.
