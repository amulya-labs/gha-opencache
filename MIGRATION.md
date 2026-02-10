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

## Google Cloud Storage (GCS) Setup

GCS requires creating a bucket and setting up authentication via service account keys or Workload Identity Federation (recommended).

### Option 1: Service Account Key (Simple)

**1. Create bucket:**
```bash
# Create bucket in your GCP project
gsutil mb -p my-project -l us-central1 gs://my-gha-cache-bucket

# Or using gcloud
gcloud storage buckets create gs://my-gha-cache-bucket --project=my-project --location=us-central1
```

**2. Create service account:**
```bash
# Create service account
gcloud iam service-accounts create github-actions-cache \
  --project=my-project \
  --display-name="GitHub Actions Cache"

# Grant Storage Object Admin role on the bucket
gsutil iam ch serviceAccount:github-actions-cache@my-project.iam.gserviceaccount.com:roles/storage.objectAdmin \
  gs://my-gha-cache-bucket

# Or using gcloud
gcloud storage buckets add-iam-policy-binding gs://my-gha-cache-bucket \
  --member=serviceAccount:github-actions-cache@my-project.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

**3. Generate and download key:**
```bash
gcloud iam service-accounts keys create gha-cache-key.json \
  --iam-account=github-actions-cache@my-project.iam.gserviceaccount.com \
  --project=my-project
```

**4. Add key to GitHub secrets:**
- Go to your repository → Settings → Secrets and variables → Actions
- Create new secret: `GCP_SA_KEY`
- Paste the entire contents of `gha-cache-key.json`

**5. Configure workflow:**
```yaml
- name: Set up GCP credentials
  run: |
    echo '${{ secrets.GCP_SA_KEY }}' > ${{ runner.temp }}/gcp-key.json
    echo "GOOGLE_APPLICATION_CREDENTIALS=${{ runner.temp }}/gcp-key.json" >> $GITHUB_ENV

- uses: rrl-personal-projects/actions-opencache@v1
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

### Option 2: Workload Identity Federation (Recommended, Keyless)

Workload Identity eliminates the need for service account keys and provides better security.

**1. Create Workload Identity Pool:**
```bash
# Create pool
gcloud iam workload-identity-pools create github-pool \
  --project=my-project \
  --location=global \
  --display-name="GitHub Actions Pool"

# Create provider for GitHub
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --project=my-project \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'your-github-org'" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

**2. Create service account and grant permissions:**
```bash
# Create service account
gcloud iam service-accounts create github-actions-cache \
  --project=my-project \
  --display-name="GitHub Actions Cache"

# Grant Storage Object Admin role
gcloud storage buckets add-iam-policy-binding gs://my-gha-cache-bucket \
  --member=serviceAccount:github-actions-cache@my-project.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin

# Allow GitHub Actions to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding github-actions-cache@my-project.iam.gserviceaccount.com \
  --project=my-project \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/your-github-org/your-repo"
```

Replace `PROJECT_NUMBER` with your GCP project number (find it with `gcloud projects describe my-project --format='value(projectNumber)'`).

**3. Configure workflow:**
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # Required for Workload Identity

    steps:
      - uses: actions/checkout@v4

      # Authenticate using Workload Identity
      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
          service_account: github-actions-cache@my-project.iam.gserviceaccount.com

      # Use GCS cache (credentials automatically available via ADC)
      - uses: rrl-personal-projects/actions-opencache@v1
        with:
          storage-provider: gcs
          gcs-bucket: my-gha-cache-bucket
          gcs-project: my-project
          path: node_modules
          key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

**Benefits of Workload Identity:**
- No service account keys to manage or rotate
- Automatic credential expiration
- Better security posture (no long-lived credentials)
- Fine-grained access control per repository

**Required IAM Permissions:**

For the service account, grant `roles/storage.objectAdmin` on the bucket, which includes:
- `storage.objects.create`
- `storage.objects.delete`
- `storage.objects.get`
- `storage.objects.list`

**Troubleshooting:**
- Verify Workload Identity setup: `gcloud iam workload-identity-pools providers describe github-provider --project=my-project --location=global --workload-identity-pool=github-pool`
- Check service account permissions: `gsutil iam get gs://my-gha-cache-bucket`
- Enable debug logging: Set `ACTIONS_STEP_DEBUG: true` in workflow environment

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

GCS:
```bash
gsutil ls -r gs://my-gha-cache-bucket/gha-cache/
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
