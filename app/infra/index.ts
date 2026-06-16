import * as pulumi from '@pulumi/pulumi';
import { createNetwork } from './network';
import { createVmServiceAccount } from './iam';
import { createInstance } from './compute';
import { appPort } from './config';

const { subnet } = createNetwork();
const vmSa = createVmServiceAccount();
const instance = createInstance(subnet, vmSa);

export const instanceName = instance.name;

export const externalIp = instance.networkInterfaces.apply(
  (nics) => nics[0]?.accessConfigs?.[0]?.natIp ?? 'pending',
);

export const appUrl = pulumi.interpolate`http://${externalIp}:${appPort}`;
