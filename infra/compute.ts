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

// Container-Optimized OS ships with Docker and gcloud pre-installed.
// It is security-hardened and receives automatic security patches.
const COS_IMAGE_FAMILY = 'cos-stable';
const COS_IMAGE_PROJECT = 'cos-cloud';

function buildStartupScript(): string {
  // Debug from inside the VM with: cat /tmp/hello-startup.log
  return `#!/bin/bash
LOGFILE=/tmp/hello-startup.log

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOGFILE"; }

log "=== startup begin ==="

# ── 1. Wait for Docker daemon ───────────────────────────────────────────────
log "Waiting for Docker daemon..."
for i in $(seq 1 30); do
  docker info > /dev/null 2>&1 && { log "Docker ready after $((i * 2))s"; break; }
  sleep 2
  [ "$i" -eq 30 ] && { log "ERROR: Docker never started"; exit 1; }
done

REGISTRY="${registryHost}"
IMAGE="${imageUrl}"

# ── 2. Auth via metadata server (no gcloud PATH dependency) ─────────────────
# On COS, gcloud is not in PATH during startup script execution.
# The metadata server is always reachable and returns the VM SA token directly.
log "Fetching SA token from metadata server..."
TOKEN=$(curl -sf \\
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \\
  -H "Metadata-Flavor: Google" | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  log "ERROR: metadata server returned empty token — check VM SA and cloud-platform scope"
  exit 1
fi

log "Logging in to $REGISTRY..."
echo "$TOKEN" | docker login \\
  --username oauth2accesstoken \\
  --password-stdin \\
  "https://$REGISTRY" >> "$LOGFILE" 2>&1 || { log "ERROR: docker login failed"; exit 1; }

# ── 3. Pull image ────────────────────────────────────────────────────────────
log "Pulling $IMAGE..."
docker pull "$IMAGE" >> "$LOGFILE" 2>&1 || {
  log "ERROR: docker pull failed — verify image tag exists and SA has roles/artifactregistry.reader"
  exit 1
}

# ── 4. Run container ─────────────────────────────────────────────────────────
log "Stopping existing container..."
docker stop hello-app >> "$LOGFILE" 2>&1 || true
docker rm   hello-app >> "$LOGFILE" 2>&1 || true

log "Starting container on port ${appPort}..."
docker run -d \\
  --name hello-app \\
  --restart unless-stopped \\
  -p ${appPort}:${appPort} \\
  -e NODE_ENV=${environment} \\
  -e APP_VERSION=${imageTag} \\
  "$IMAGE" >> "$LOGFILE" 2>&1 || { log "ERROR: docker run failed"; exit 1; }

log "Container status:"
docker ps --filter name=hello-app --format "  ID={{.ID}} Status={{.Status}} Ports={{.Ports}}" | tee -a "$LOGFILE"
log "=== startup complete ==="
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
        image: `projects/${COS_IMAGE_PROJECT}/global/images/family/${COS_IMAGE_FAMILY}`,
        size: 20,
        type: 'pd-balanced',
      },
    },

    networkInterfaces: [
      {
        subnetwork: subnet.selfLink,
        // Ephemeral external IP — sufficient for this project.
        // Harden to: no external IP + Cloud NAT + internal load balancer in prod.
        accessConfigs: [{ networkTier: 'STANDARD' }],
      },
    ],

    serviceAccount: {
      email: vmSa.email,
      // cloud-platform scope lets the SA use any GCP API its IAM bindings permit.
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    },

    metadataStartupScript: buildStartupScript(),

    labels: {
      environment,
      managed_by: 'pulumi',
      app: 'hello-app',
    },

    deletionProtection: false, // enable once a load balancer sits in front
  }, {
    // Recreate the VM whenever the startup script changes (i.e. new image tag).
    // Without this, Pulumi only updates the stored metadata; GCE never re-runs
    // the script and the old container keeps serving the old image.
    replaceOnChanges: ['metadataStartupScript'],
  });

  return instance;
}
