import * as gcp from '@pulumi/gcp';
import {
  environment,
  projectId,
  zone,
  machineType,
  appPort,
  imageUrl,
  registryHost,
  imageTag,
} from './config';

// Ubuntu 22.04 LTS:
//  - google-startup-scripts.service is reliable and well-tested on this family
//  - full bash (not busybox), so process substitution and all builtins work
//  - gcloud is in PATH, though we don't rely on it (we use the metadata server)
const VM_IMAGE_PROJECT = 'ubuntu-os-cloud';
const VM_IMAGE_FAMILY  = 'ubuntu-2204-lts';

function buildStartupScript(): string {
  // All output goes to both /var/log/hello-startup.log AND the serial console.
  // Debug from inside the VM:  sudo cat /var/log/hello-startup.log
  // Debug from GCP console:    Compute Engine → VM → Serial port 1 (CONSOLE)
  return `#!/bin/bash
LOGFILE=/var/log/hello-startup.log

# Redirect every line (stdout + stderr) to the log file AND the serial console.
# exec-based redirect requires full bash — verified on ubuntu-2204-lts.
exec > >(tee -a "$LOGFILE") 2>&1

echo "[startup] === begin ==="

# ── 1. Install Docker (idempotent) ───────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "[startup] Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq docker.io
  systemctl enable docker --now
  echo "[startup] Docker installed"
else
  echo "[startup] Docker already present"
fi

# ── 2. Wait for Docker daemon ────────────────────────────────────────────────
echo "[startup] Waiting for Docker daemon..."
for i in $(seq 1 30); do
  docker info > /dev/null 2>&1 && { echo "[startup] Docker ready after $((i * 2))s"; break; }
  sleep 2
  [ "$i" -eq 30 ] && { echo "[startup] ERROR: Docker daemon never started"; exit 1; }
done

REGISTRY="${registryHost}"
IMAGE="${imageUrl}"

# ── 3. Auth via metadata server (no gcloud PATH required) ───────────────────
echo "[startup] Fetching SA token from metadata server..."
TOKEN=$(curl -sf \\
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \\
  -H "Metadata-Flavor: Google" | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "[startup] ERROR: empty token — check VM SA has cloud-platform scope"
  exit 1
fi

echo "[startup] Logging in to $REGISTRY..."
echo "$TOKEN" | docker login \\
  --username oauth2accesstoken \\
  --password-stdin \\
  "https://$REGISTRY" || { echo "[startup] ERROR: docker login failed"; exit 1; }

# ── 4. Pull ──────────────────────────────────────────────────────────────────
echo "[startup] Pulling $IMAGE..."
docker pull "$IMAGE" || {
  echo "[startup] ERROR: docker pull failed — check image tag exists and SA has roles/artifactregistry.reader"
  exit 1
}

# ── 5. Run ───────────────────────────────────────────────────────────────────
echo "[startup] Stopping previous container (if any)..."
docker stop hello-app 2>/dev/null || true
docker rm   hello-app 2>/dev/null || true

echo "[startup] Starting container on port ${appPort}..."
docker run -d \\
  --name hello-app \\
  --restart unless-stopped \\
  -p ${appPort}:${appPort} \\
  -e NODE_ENV=${environment} \\
  -e APP_VERSION=${imageTag} \\
  "$IMAGE" || { echo "[startup] ERROR: docker run failed"; exit 1; }

echo "[startup] Container status:"
docker ps --filter name=hello-app --format "  {{.ID}}  {{.Status}}  {{.Ports}}"
echo "[startup] === complete ==="
`;
}

export function createInstance(
  subnet: gcp.compute.Subnetwork,
  vmSa: gcp.serviceaccount.Account,
) {
  const instance = new gcp.compute.Instance(`hello-app-${environment}`, {
    project: projectId,
    zone,
    machineType,
    tags: ['hello-app'],

    bootDisk: {
      initializeParams: {
        image: `projects/${VM_IMAGE_PROJECT}/global/images/family/${VM_IMAGE_FAMILY}`,
        size: 20,
        type: 'pd-balanced',
      },
    },

    networkInterfaces: [
      {
        subnetwork: subnet.selfLink,
        accessConfigs: [{ networkTier: 'STANDARD' }],
      },
    ],

    serviceAccount: {
      email: vmSa.email,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    },

    metadataStartupScript: buildStartupScript(),

    labels: {
      environment,
      managed_by: 'pulumi',
      app: 'hello-app',
    },

    deletionProtection: false,
  }, {
    // Recreate the VM whenever the startup script changes (new image tag = new script).
    // Without this, Pulumi only patches metadata; the old container keeps running.
    replaceOnChanges: ['metadataStartupScript'],
  });

  return instance;
}
