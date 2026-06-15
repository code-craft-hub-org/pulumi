# Setup Runbook

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22 LTS | https://nodejs.org |
| Docker | 24+ | https://docs.docker.com/get-docker |
| gcloud CLI | latest | https://cloud.google.com/sdk/docs/install |
| Pulumi CLI | 3.x | `npm i -g pulumi` |

## One-time bootstrap (run locally as project owner)

```bash
# Authenticate gcloud
gcloud auth login
gcloud auth application-default login
gcloud config set project cverai

# Make script executable and run
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

The script will print the exact values you need for GitHub Secrets.

## GitHub configuration

### Secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|--------|-------|
| `GCP_WIF_PROVIDER` | printed by bootstrap.sh |
| `GCP_SA_EMAIL` | printed by bootstrap.sh |
| `PULUMI_ACCESS_TOKEN` | https://app.pulumi.com/account/tokens |

### Environments (Settings → Environments)

Create one environment named **`production`**:
- Required reviewers: add yourself or a team
- Deployment branches: restrict to `main`

No environment config needed for staging — it deploys automatically.

## Push your first commit

```bash
git init
git remote add origin https://github.com/code-craft-hub/pulumi.git
git add .
git commit -m "chore: initial project scaffold"
git push -u origin main
```

The deploy workflow starts immediately. After staging is healthy, you'll see
a pending approval in the Actions tab under the `production` environment.

## Pipeline diagram

```
push to main
    │
    ▼
build-and-push ──── Docker image → Artifact Registry
    │                   (tagged with git SHA)
    ▼
deploy-staging ──── Pulumi up (staging stack)
    │                   └─ VPC + subnet + firewall + VM SA + GCE VM
    │               Health check + smoke tests
    │
    ▼
deploy-production ── ⏸ MANUAL APPROVAL (GitHub Environment gate)
    │                   Pulumi up (production stack)
    │                   Health check + smoke tests
    │
    ▼
destroy-staging ──── Pulumi destroy + stack rm (staging)
```

## Deploying a new version

Every push to `main` triggers the full pipeline. The image tag is the git commit
SHA, so rollback is just reverting a commit and pushing.

## Rollback

```bash
git revert HEAD
git push origin main
```

The pipeline redeploys the previous image through the same staging → approval → prod flow.

## Emergency: manual Pulumi operations

```bash
cd infra

# Preview what would change in production
pulumi preview --stack production

# Apply production directly (bypass CI — use only in incidents)
PULUMI_ACCESS_TOKEN=<token> pulumi up --stack production

# Tail production logs
gcloud logging read \
  'resource.type="gce_instance" AND labels."compute.googleapis.com/resource_name"="hello-app-production"' \
  --project=cverai --format=json | jq -r '.[].textPayload' | head -50
```

## Production hardening (next steps)

- Replace ephemeral external IP with a static IP + Cloud Load Balancer + managed TLS cert
- Move VMs to a private subnet behind Cloud NAT (no external IP on VMs)
- Add Cloud Armor WAF policy to the load balancer
- Enable VPC Flow Logs and Cloud Audit Logs
- Lock down the GitHub Actions SA with a custom IAM role (least-privilege)
- Add Dependabot for Docker + npm + Actions version pinning
