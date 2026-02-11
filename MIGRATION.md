# Migration Guide

Migration from `actions/cache` and storage backend setup.

## From actions/cache

**Two steps:** (1) Change `uses: actions/cache@v4` → `amulya-labs/gha-opencache@v1` | (2) Choose storage (see below)

All inputs, outputs, and behavior are identical.

<details>
<summary>Optional: Configure Additional Features</summary>

`gha-opencache` adds optional features beyond `actions/cache`:

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

**Create directory:**

Linux/macOS:
```bash
sudo mkdir -p /srv/gha-cache/v1
sudo chown -R runner-user:runner-group /srv/gha-cache/v1
chmod 755 /srv/gha-cache/v1
```

Windows (PowerShell as Admin):
```powershell
New-Item -Path "C:\gha-cache\v1" -ItemType Directory -Force
```

**Verify:** `sudo -u runner-user touch /srv/gha-cache/v1/test && rm /srv/gha-cache/v1/test`

**Storage:** `(repos) × (max-cache-size-gb) × 1.2` (e.g., 5 repos × 10 GB × 1.2 = 60 GB)

**Custom path:** Use `cache-path: /mnt/ssd-cache/gha` input

<details>
<summary>Monitoring & Cleanup</summary>

```bash
# Monitor disk usage (cron)
0 */6 * * * df -h /srv/gha-cache | mail -s "Cache" admin@example.com

# Manual cleanup (>30 days)
find /srv/gha-cache/v1 -type f -mtime +30 -delete
```

</details>

## S3-Compatible Storage Setup

**Steps:** (1) Create bucket | (2) Create credentials with perms: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` | (3) Add to GitHub secrets | (4) Configure workflow

**Common workflow config:**
```yaml
- uses: amulya-labs/gha-opencache@v1
  with:
    storage-provider: s3
    s3-bucket: my-cache-bucket
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.S3_ACCESS_KEY }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.S3_SECRET_KEY }}
```

Provider-specific settings in collapsible sections below.

<details>
<summary>AWS S3</summary>

**Create:** `aws s3 mb s3://my-gha-cache-bucket --region us-west-2`

**IAM Policy:** `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` on bucket + `/*`

**Specific config:**
```yaml
s3-region: us-west-2
# s3-endpoint: (omit for AWS - uses default)
```

</details>

<details>
<summary>MinIO</summary>

**Deploy:** `docker run -d -p 9000:9000 quay.io/minio/minio server /data`

**Create bucket:** `mc alias set myminio http://localhost:9000 admin password` → `mc mb myminio/github-actions-cache`

**Specific config:**
```yaml
s3-endpoint: https://minio.example.com
s3-region: us-east-1
s3-force-path-style: true  # Required
```

</details>

<details>
<summary>Cloudflare R2</summary>

**Create:** Dashboard → R2 → Create bucket → Manage API Tokens → Create (Object Read & Write)

**Specific config:**
```yaml
s3-endpoint: https://<account-id>.r2.cloudflarestorage.com
s3-region: auto
```

</details>

<details>
<summary>DigitalOcean Spaces</summary>

**Create:** Control Panel → Spaces → Create Space → API Tokens → Generate (Spaces access)

**Specific config:**
```yaml
s3-endpoint: https://nyc3.digitaloceanspaces.com
s3-region: us-east-1
```

</details>

## Google Cloud Storage (GCS) Setup

Two auth options: **Service Account Key** (simple) or **Workload Identity** (recommended, keyless)

**Common setup:**
```bash
# Create bucket
gsutil mb -p my-project -l us-central1 gs://my-gha-cache-bucket

# Create service account + grant storage.objectAdmin
gcloud iam service-accounts create github-actions-cache --project=my-project
gcloud storage buckets add-iam-policy-binding gs://my-gha-cache-bucket \
  --member=serviceAccount:github-actions-cache@my-project.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

### Option 1: Service Account Key

**Generate key:**
```bash
gcloud iam service-accounts keys create gha-cache-key.json \
  --iam-account=github-actions-cache@my-project.iam.gserviceaccount.com
```

**Add to GitHub secrets:** Repo Settings → Secrets → New: `GCP_SA_KEY` = contents of `gha-cache-key.json`

**Workflow:**
```yaml
- name: Set up GCP credentials
  run: |
    echo '${{ secrets.GCP_SA_KEY }}' > ${{ runner.temp }}/gcp-key.json
    echo "GOOGLE_APPLICATION_CREDENTIALS=${{ runner.temp }}/gcp-key.json" >> $GITHUB_ENV

- uses: amulya-labs/gha-opencache@v1
  with:
    storage-provider: gcs
    gcs-bucket: my-gha-cache-bucket
    gcs-project: my-project
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

- name: Clean up credentials
  if: always()
  run: rm -f ${{ runner.temp }}/gcp-key.json
```

### Option 2: Workload Identity (Recommended)

**Benefits:** No keys to manage • Auto-expiring credentials • Better security

**Setup Workload Identity Pool:**
```bash
# Create pool + provider
gcloud iam workload-identity-pools create github-pool --project=my-project --location=global
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --project=my-project --location=global --workload-identity-pool=github-pool \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository_owner == 'your-org'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Allow impersonation
gcloud iam service-accounts add-iam-policy-binding github-actions-cache@my-project.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/your-org/your-repo"
```

Replace `PROJECT_NUMBER` (find: `gcloud projects describe my-project --format='value(projectNumber)'`)

**Workflow:**
```yaml
jobs:
  build:
    permissions:
      id-token: write  # Required
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
          service_account: github-actions-cache@my-project.iam.gserviceaccount.com
      - uses: amulya-labs/gha-opencache@v1
        with:
          storage-provider: gcs
          gcs-bucket: my-gha-cache-bucket
          path: node_modules
          key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

## Testing

**Save:** `key: test-${{ github.run_number }}` **Restore:** `key: test-999, restore-keys: test-`

**Verify storage:**
- Local: `ls /srv/gha-cache/v1/owner/repo/archives/`
- S3: `aws s3 ls s3://my-bucket/gha-cache/ --recursive`
- GCS: `gsutil ls -r gs://my-bucket/gha-cache/`

**Checklist:** Permissions ✓ • Disk space ✓ • Credentials ✓ • Key format ✓ • Debug: `ACTIONS_STEP_DEBUG: true`

→ [README.md#troubleshooting](README.md#troubleshooting)
