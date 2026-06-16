import * as gcp from '@pulumi/gcp';
import { environment, projectId, region, appPort } from './config';

// CIDRs are in non-overlapping ranges per environment even though VPCs are isolated,
// which makes VPC peering or shared-VPC migration trivial later.
const CIDR: Record<string, string> = {
  production: '10.0.0.0/24',
  staging: '10.1.0.0/24',
};

export function createNetwork() {
  const vpc = new gcp.compute.Network(`hello-app-vpc-${environment}`, {
    project: projectId,
    autoCreateSubnetworks: false,
    description: `VPC for hello-app ${environment}`,
  });

  const subnet = new gcp.compute.Subnetwork(`hello-app-subnet-${environment}`, {
    project: projectId,
    region,
    network: vpc.selfLink,
    ipCidrRange: CIDR[environment] ?? '10.2.0.0/24',
    privateIpGoogleAccess: true,
  });

  // Inbound: allow app port from the internet
  new gcp.compute.Firewall(`hello-app-allow-http-${environment}`, {
    project: projectId,
    network: vpc.selfLink,
    allows: [{ protocol: 'tcp', ports: [String(appPort)] }],
    sourceRanges: ['0.0.0.0/0'],
    targetTags: ['hello-app'],
    description: `Allow inbound traffic on port ${appPort}`,
  });

  // Inbound: allow SSH only from Identity-Aware Proxy — never open 22 to the world
  new gcp.compute.Firewall(`hello-app-allow-iap-${environment}`, {
    project: projectId,
    network: vpc.selfLink,
    allows: [{ protocol: 'tcp', ports: ['22'] }],
    sourceRanges: ['35.235.240.0/20'],
    targetTags: ['hello-app'],
    description: 'Allow SSH via IAP only',
  });

  return { vpc, subnet };
}
