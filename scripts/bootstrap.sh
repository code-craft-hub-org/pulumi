#!/usr/bin/env bash
# Run once from your local machine before the first CI deploy.
# Prerequisites: gcloud CLI authenticated as a project owner, Pulumi CLI installed.
set -euo pipefail

PROJECT_ID="cverai"
PROJECT_NUMBER="865996551693"
REGION="us-east1"
REGISTRY_NAME="hello-app"
GITHUB_ORG="code-craft-hub"
GITHUB_REPO="pulumi"
WIF_POOL_ID="github-actions-pool"
WIF_PROVIDER_ID="github-actions-provider"
GH_SA_NAME="github-actions-deployer"

GH_SA_EMAIL="${GH_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WIF_POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}"
WIF_PROVIDER_RESOURCE="${WIF_POOL_RESOURCE}/providers/${WIF_PROVIDER_ID}"

echo "──────────────────────────────────────────────────────────"
echo " Bootstrapping hello-app GCP + Pulumi (project: $PROJECT_ID)"
echo "──────────────────────────────────────────────────────────"

# ── 1. Enable APIs ───────────────────────────────────────────────────────────
echo ""
echo "[1/7] Enabling required GCP APIs..."
gcloud services enable \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  --project="$PROJECT_ID"

# ── 2. Artifact Registry ─────────────────────────────────────────────────────
echo ""
echo "[2/7] Creating Artifact Registry repository '${REGISTRY_NAME}'..."
gcloud artifacts repositories create "$REGISTRY_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Docker images for hello-app" \
  --project="$PROJECT_ID" 2>/dev/null || echo "  Already exists, skipping."

# ── 3. Workload Identity Pool ─────────────────────────────────────────────────
echo ""
echo "[3/7] Creating Workload Identity Pool..."
gcloud iam workload-identity-pools create "$WIF_POOL_ID" \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --project="$PROJECT_ID" 2>/dev/null || echo "  Already exists, skipping."

# ── 4. Workload Identity Provider ─────────────────────────────────────────────
echo ""
echo "[4/7] Creating Workload Identity Provider (OIDC)..."
gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_ID" \
  --location=global \
  --workload-identity-pool="$WIF_POOL_ID" \
  --display-name="GitHub Actions OIDC" \
  --attribute-mapping="\
google.subject=assertion.sub,\
attribute.actor=assertion.actor,\
attribute.repository=assertion.repository,\
attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == '${GITHUB_ORG}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --project="$PROJECT_ID" 2>/dev/null || echo "  Already exists, skipping."

# ── 5. GitHub Actions Service Account ────────────────────────────────────────
echo ""
echo "[5/7] Creating GitHub Actions service account..."
gcloud iam service-accounts create "$GH_SA_NAME" \
  --display-name="GitHub Actions Deployer" \
  --project="$PROJECT_ID" 2>/dev/null || echo "  Already exists, skipping."

echo "  Granting project roles..."
for ROLE in \
  "roles/compute.admin" \
  "roles/iam.serviceAccountAdmin" \
  "roles/iam.serviceAccountUser" \
  "roles/resourcemanager.projectIamAdmin" \
  "roles/artifactregistry.admin"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${GH_SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None \
    --quiet
done

# ── 6. Bind WIF → GitHub Actions SA ──────────────────────────────────────────
echo ""
echo "[6/7] Binding Workload Identity to service account..."
gcloud iam service-accounts add-iam-policy-binding "$GH_SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WIF_POOL_RESOURCE}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}" \
  --project="$PROJECT_ID"

# ── 7. Initialize Pulumi production stack ────────────────────────────────────
echo ""
echo "[7/7] Initializing Pulumi stacks..."
(
  cd "$(dirname "$0")/../infra"

  pulumi stack select production 2>/dev/null || pulumi stack init production
  pulumi config set gcp:project  "$PROJECT_ID"         --stack production
  pulumi config set gcp:region   "$REGION"             --stack production
  pulumi config set gcp:zone     "${REGION}-b"         --stack production
  pulumi config set hello-app:imageTag "latest"        --stack production
  echo "  Production stack ready."
)

# ── Summary ───────────────────────────────────────────────────────────────────
cat <<EOF

══════════════════════════════════════════════════════════════
 Bootstrap complete. Add these secrets to your GitHub repo:
 (Settings → Secrets and variables → Actions → New repository secret)

  GCP_WIF_PROVIDER  →  ${WIF_PROVIDER_RESOURCE}
  GCP_SA_EMAIL      →  ${GH_SA_EMAIL}
  PULUMI_ACCESS_TOKEN → (from https://app.pulumi.com/account/tokens)

 Then configure GitHub Environments:
  1. Settings → Environments → New: "production"
  2. Add required reviewers (yourself or a team)
  3. Restrict deployments to branch "main"
══════════════════════════════════════════════════════════════
EOF
