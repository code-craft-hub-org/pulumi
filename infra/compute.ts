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
  // All output is tagged so you can debug with:
  //   gcloud compute ssh hello-app-<env> --zone=us-east1-b --tunnel-through-iap
  //   journalctl -t hello-startup -f
  return `#!/bin/bash

LOG() { echo "[hello-startup] $*" | tee >(logger -t hello-startup); }

LOG "=== startup begin ==="

# Wait for the Docker daemon (COS starts it as a service; give it up to 60s)
LOG "Waiting for Docker daemon..."
DOCKER_READY=0
for i in $(seq 1 30); do
  if docker info > /dev/null 2>&1; then
    DOCKER_READY=1
    LOG "Docker ready after $((i * 2))s"
    break
  fi
  sleep 2
done
if [ "$DOCKER_READY" -eq 0 ]; then
  LOG "ERROR: Docker daemon did not start within 60s — aborting"
  exit 1
fi

REGISTRY="${registryHost}"
IMAGE="${imageUrl}"

LOG "Configuring Docker credentials for $REGISTRY..."
if ! gcloud auth configure-docker "$REGISTRY" --quiet; then
  LOG "ERROR: gcloud auth configure-docker failed"
  exit 1
fi

LOG "Pulling $IMAGE..."
if ! docker pull "$IMAGE"; then
  LOG "ERROR: docker pull failed — check that the image exists and the VM SA has roles/artifactregistry.reader"
  exit 1
fi

LOG "Stopping any previous container..."
docker stop hello-app 2>/dev/null || true
docker rm   hello-app 2>/dev/null || true

LOG "Starting container on port ${appPort}..."
# gcplogs driver omitted: it requires Cloud Logging API to be reachable before the
# container starts, which races with network readiness on first boot.
docker run -d \\
  --name hello-app \\
  --restart unless-stopped \\
  -p ${appPort}:${appPort} \\
  -e NODE_ENV=${environment} \\
  -e APP_VERSION=${imageTag} \\
  "$IMAGE"

LOG "Container status:"
docker ps --filter name=hello-app --format "table {{.ID}}\\t{{.Status}}\\t{{.Ports}}"

LOG "=== startup complete ==="
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

    deletionProtection: environment === 'production',
  });

  return instance;
}
