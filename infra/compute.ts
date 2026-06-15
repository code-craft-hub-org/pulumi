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
  return `#!/bin/bash
set -euo pipefail

REGISTRY="${registryHost}"
IMAGE="${imageUrl}"

echo "[startup] Configuring Docker credentials for Artifact Registry..."
gcloud auth configure-docker "$REGISTRY" --quiet

echo "[startup] Pulling image $IMAGE..."
docker pull "$IMAGE"

echo "[startup] Stopping any previous container..."
docker stop hello-app 2>/dev/null || true
docker rm   hello-app 2>/dev/null || true

echo "[startup] Starting container..."
docker run -d \\
  --name hello-app \\
  --restart unless-stopped \\
  -p ${appPort}:${appPort} \\
  -e NODE_ENV=${environment} \\
  -e APP_VERSION=${imageTag} \\
  --log-driver=gcplogs \\
  --log-opt gcp-project=${projectId} \\
  --log-opt gcp-log-cmd=true \\
  "$IMAGE"

echo "[startup] Done."
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
