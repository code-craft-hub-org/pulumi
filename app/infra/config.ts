import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config('gcp');

export const projectId = gcpConfig.require('project');
export const region = gcpConfig.get('region') ?? 'us-east1';
export const zone = gcpConfig.get('zone') ?? `${region}-b`;

// Set per-deploy by CI via: pulumi config set hello-app:imageTag <sha>
export const imageTag = config.get('imageTag') ?? 'latest';

// Stack name is the environment name ("staging" | "production")
export const environment = pulumi.getStack();

export const machineType =
  config.get('machineType') ?? (environment === 'production' ? 'e2-small' : 'e2-micro');

export const appPort = 3000;

export const registryHost = `${region}-docker.pkg.dev`;
export const imageUrl = `${registryHost}/${projectId}/hello-app/hello-app:${imageTag}`;
