import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';
import { environment, projectId } from './config';

export function createVmServiceAccount() {
  const sa = new gcp.serviceaccount.Account(`hello-app-vm-sa-${environment}`, {
    project: projectId,
    accountId: `hello-app-vm-${environment}`,
    displayName: `hello-app VM (${environment})`,
  });

  const member = pulumi.interpolate`serviceAccount:${sa.email}`;

  // Pull images from the shared Artifact Registry repository
  new gcp.projects.IAMMember(`hello-app-ar-reader-${environment}`, {
    project: projectId,
    role: 'roles/artifactregistry.reader',
    member,
  });

  // Write structured logs to Cloud Logging
  new gcp.projects.IAMMember(`hello-app-log-writer-${environment}`, {
    project: projectId,
    role: 'roles/logging.logWriter',
    member,
  });

  // Emit custom metrics to Cloud Monitoring
  new gcp.projects.IAMMember(`hello-app-metrics-writer-${environment}`, {
    project: projectId,
    role: 'roles/monitoring.metricWriter',
    member,
  });

  return sa;
}
